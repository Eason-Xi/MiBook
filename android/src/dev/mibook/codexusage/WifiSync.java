package dev.mibook.codexusage;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.util.AtomicFile;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import org.json.JSONArray;

/** Only quota snapshots and a local pairing token cross the LAN. */
final class WifiSync {
    interface Callback { void complete(boolean success); }
    private final Context context;
    private final Handler handler;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Callback callback;
    private final NsdManager nsd;
    private NsdManager.DiscoveryListener discovery;
    private JSONObject config;
    private volatile String discoveredHost;
    private volatile int discoveredPort;
    private boolean active;
    private boolean busy;
    private boolean resolving;
    private final ScreensaverSync screensaver;
    private final Runnable scheduledSync = new Runnable() {
        @Override public void run() {
            if (!active) return;
            scheduleNext();
            Log.i("MiBookUsage", "Five-minute clock-slot sync fired");
            fetch(true);
        }
    };

    private void scheduleNext() {
        handler.removeCallbacks(scheduledSync);
        if (!active) return;
        long now = System.currentTimeMillis();
        long delay = 300000 - now % 300000;
        Log.i("MiBookUsage", "Next clock-slot sync at epochMillis=" + (now + delay));
        handler.postDelayed(scheduledSync, delay);
    }

    WifiSync(Context context, Handler handler, Callback callback) {
        this.context = context; this.handler = handler; this.callback = callback;
        nsd = (NsdManager)context.getSystemService(Context.NSD_SERVICE);
        try {
            File dir = context.getExternalFilesDir(null);
            File incoming = dir == null ? null : new File(dir, "wifi-config.json");
            File saved = new File(context.getFilesDir(), "wifi-config.json");
            if (incoming != null && incoming.exists()) {
                String raw = read(new FileInputStream(incoming));
                JSONObject candidate = new JSONObject(raw);
                if (!candidate.getString("token").matches("[a-f0-9]{64}")
                    || !candidate.getString("serviceName").startsWith("MiBookCodex-")) throw new Exception("Invalid pairing");
                write(saved, raw);
                incoming.delete();
            }
            config = new JSONObject(read(new FileInputStream(saved)));
        } catch (Exception e) { Log.w("MiBookUsage", "Wi-Fi pairing unavailable"); }
        screensaver = new ScreensaverSync(context, handler, config, new ScreensaverSync.Address() {
            public String host() { return discoveredHost; }
            public int port() { return discoveredPort; }
        });
    }
    static String read(InputStream stream) throws Exception {
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096]; int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (out.size() > 65536) throw new Exception("Response too large");
            }
            return out.toString("UTF-8");
        }
    }
    static void write(File file, String value) throws Exception {
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream stream = atomic.startWrite();
        try { stream.write(value.getBytes("UTF-8")); atomic.finishWrite(stream); }
        catch (Exception error) { atomic.failWrite(stream); throw error; }
    }
    boolean paired() { return config != null; }
    boolean busy() { return busy; }
    void start() { active = true; scheduleNext(); discover(); fetch(true); screensaver.start(); }
    void stop() {
        active = false;
        screensaver.stop();
        handler.removeCallbacks(scheduledSync);
        if (discovery != null) {
            try { nsd.stopServiceDiscovery(discovery); } catch (Exception ignored) {}
            discovery = null;
        }
    }
    void close() { stop(); executor.shutdownNow(); screensaver.close(); }
    private void discover() {
        if (config == null || discovery != null || !active) return;
        discovery = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String type) {}
            @Override public void onDiscoveryStopped(String type) {}
            @Override public void onStartDiscoveryFailed(String type, int code) {
                handler.post(() -> {
                    if (discovery != null) {
                        try { nsd.stopServiceDiscovery(discovery); } catch (Exception ignored) {}
                        discovery = null;
                    }
                });
            }
            @Override public void onStopDiscoveryFailed(String type, int code) {}
            @Override public void onServiceLost(NsdServiceInfo info) {
                if (info.getServiceName().equals(config.optString("serviceName"))) discoveredHost = null;
            }
            @Override public void onServiceFound(NsdServiceInfo info) {
                if (!info.getServiceName().equals(config.optString("serviceName")) || resolving) return;
                resolving = true;
                nsd.resolveService(info, new NsdManager.ResolveListener() {
                    @Override public void onResolveFailed(NsdServiceInfo service, int code) { resolving = false; }
                    @Override public void onServiceResolved(NsdServiceInfo service) {
                        resolving = false;
                        if (service.getHost() == null) return;
                        discoveredHost = service.getHost().getHostAddress();
                        discoveredPort = service.getPort();
                        Log.i("MiBookUsage", "Mac discovered on Wi-Fi: " + discoveredHost);
                        handler.post(() -> { if (active) fetch(false); });
                    }
                });
            }
        };
        try { nsd.discoverServices("_mibookusage._tcp.", NsdManager.PROTOCOL_DNS_SD, discovery); }
        catch (Exception e) { discovery = null; }
    }
    void fetch(boolean manual) {
        if (config == null || busy || !active) return;
        discover();
        busy = true;
        final String resolved = discoveredHost;
        final int resolvedPort = discoveredPort;
        executor.execute(() -> {
            boolean success = false;
            LinkedHashSet<String> hosts = new LinkedHashSet<>();
            if (resolved != null) hosts.add(resolved);
            String last = context.getSharedPreferences("wifi", 0).getString("host", "");
            if (!last.isEmpty()) hosts.add(last);
            JSONArray configured = config.optJSONArray("hosts");
            if (configured != null) for (int i = 0; i < configured.length(); i++) hosts.add(configured.optString(i));
            for (String host : hosts) {
                if (Thread.currentThread().isInterrupted()) break;
                HttpURLConnection connection = null;
                try {
                    int port = host.equals(resolved) ? resolvedPort : config.getInt("port");
                    URL url = new URL("http", host, port, manual ? "/refresh" : "/usage");
                    connection = (HttpURLConnection)url.openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(3500);
                    connection.setReadTimeout(manual ? 50000 : 6000);
                    connection.setUseCaches(false);
                    connection.setRequestProperty("Authorization", "Bearer " + config.getString("token"));
                    connection.setRequestMethod(manual ? "POST" : "GET");
                    if (connection.getResponseCode() != 200) throw new Exception("Usage unavailable");
                    String raw = read(connection.getInputStream());
                    JSONObject value = new JSONObject(raw);
                    if (value.optInt("schemaVersion") != 1 || value.optLong("updatedAt") <= 0) throw new Exception("Invalid snapshot");
                    write(new File(context.getFilesDir(), "usage-cache.json"), raw);
                    context.getSharedPreferences("wifi", 0).edit().putString("host", host).apply();
                    Log.i("MiBookUsage", "Wi-Fi sync OK, updatedAt=" + value.optLong("updatedAt"));
                    success = true; break;
                } catch (Exception e) { Log.w("MiBookUsage", "Wi-Fi sync attempt failed: " + e.getClass().getSimpleName()); }
                finally { if (connection != null) connection.disconnect(); }
            }
            final boolean completed = success;
            handler.post(() -> {
                busy = false;
                callback.complete(completed);
            });
        });
    }
}
