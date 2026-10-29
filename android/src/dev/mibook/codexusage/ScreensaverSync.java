package dev.mibook.codexusage;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.provider.Settings;
import android.os.Handler;
import android.util.Log;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.LinkedHashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.*;

/** Small, independent poll while the dashboard is awake; never queries upstream usage. */
final class ScreensaverSync {
    interface Address { String host(); int port(); }
    private final Context context;
    private final Handler handler;
    private final JSONObject config;
    private final Address address;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean active;
    private boolean busy;
    private long rootChecked;
    private boolean rootAvailable;
    private final Runnable poll = () -> tick();
    ScreensaverSync(Context c, Handler h, JSONObject config, Address address) {
        this.context = c; this.handler = h; this.config = config; this.address = address;
    }
    void start() { active = true; handler.removeCallbacks(poll); tick(); }
    void stop() { active = false; handler.removeCallbacks(poll); }
    void close() { stop(); worker.shutdown(); }
    private void tick() {
        if (!active || config == null) return;
        handler.removeCallbacks(poll); handler.postDelayed(poll, 5000);
        if (busy) return;
        busy = true;
        final String resolved = address.host();
        final int resolvedPort = address.port();
        worker.execute(() -> {
            LinkedHashSet<String> hosts = new LinkedHashSet<>();
            if (resolved != null) hosts.add(resolved);
            String last = context.getSharedPreferences("wifi", 0).getString("host", "");
            if (!last.isEmpty()) hosts.add(last);
            JSONArray list = config.optJSONArray("hosts");
            if (list != null) for (int i = 0; i < list.length(); i++) hosts.add(list.optString(i));
            for (String host : hosts) {
                if (!active) break;
                try {
                    int port = host.equals(resolved) ? resolvedPort : config.getInt("port");
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (rootChecked == 0 || now - rootChecked > 60000) {
                        rootAvailable = RootScreensaver.available(); rootChecked = now;
                    }
                    json(host, port, "/screensaver/reader", new JSONObject().put("protocolVersion", 2).put("rootAvailable", rootAvailable));
                    JSONObject reply = json(host, port, "/screensaver", null);
                    JSONObject command = reply.optJSONObject("command");
                    if (command != null) receive(host, port, command);
                    break;
                } catch (Exception e) { Log.w("MiBookScreensaver", "Sync: " + e.getClass().getSimpleName()); }
            }
            handler.post(() -> busy = false);
        });
    }
    private HttpURLConnection connection(String host, int port, String path) throws Exception {
        HttpURLConnection c = (HttpURLConnection)new URL("http", host, port, path).openConnection();
        c.setConnectTimeout(2000); c.setReadTimeout(7000); c.setUseCaches(false);
        c.setInstanceFollowRedirects(false);
        c.setRequestProperty("Authorization", "Bearer " + config.getString("token"));
        return c;
    }
    private JSONObject json(String host, int port, String path, JSONObject data) throws Exception {
        HttpURLConnection c = connection(host, port, path);
        try {
            if (data != null) {
                c.setRequestMethod("POST"); c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = c.getOutputStream()) { out.write(data.toString().getBytes("UTF-8")); }
            }
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            return new JSONObject(WifiSync.read(c.getInputStream()));
        } finally { c.disconnect(); }
    }
    private void receive(String host, int port, JSONObject command) throws Exception {
        String id = command.getString("id");
        if (!id.matches("[a-f0-9-]{36}")) throw new IOException("Invalid command ID");
        SharedPreferences prefs = context.getSharedPreferences("screensaver_v2", 0);
        JSONObject report;
        int boot = Settings.Global.getInt(context.getContentResolver(), "boot_count", -1);
        if (id.equals(prefs.getString("id", ""))) {
            report = new JSONObject(prefs.getString("report", "{}"));
            if (prefs.getBoolean("pending", false) && boot != prefs.getInt("boot", -1)) {
                report = verifyPending(context, prefs, command);

            }
        } else {
            report = new JSONObject().put("id", id);
            try {
                if (!"MiDuoKanReaderPro".equals(Build.MODEL) || Build.VERSION.SDK_INT != 27
                    || !"OPM1.171019.026.20220615-182206 test-keys".equals(Build.DISPLAY))
                    throw new IOException("当前仅适配这台多看 Pro / 1.1.15 固件");
                if (!"magisk-overlay".equals(command.optString("method")))
                    throw new IOException("请使用新版 Mac 工具重新发送图片");
                if (boot < 0) throw new IOException("无法读取启动次数，已停止操作");
                if (!rootAvailable) throw new IOException("请先在 Magisk 中允许「AI 用量」使用 Root，然后重新发送");
                String action = command.getString("action");
                if ("image".equals(action)) {
                    download(host, port, id, command.getString("sha256"), "image", ".png");
                    File module = download(host, port, id, command.getString("moduleSha256"), "module", ".zip");
                    try { RootScreensaver.install(context, module, command.getString("apkSha256")); }
                    finally { module.delete(); }
                } else if ("default".equals(action) || "restore".equals(action)) RootScreensaver.disable();
                else throw new IOException("Unknown action");
                report.put("status", "pending_reboot").put("message", "屏保模块已准备，正在重启阅读器…");

            } catch (Exception e) {
                report.put("status", "error").put("message", e.getMessage());
                Log.e("MiBookScreensaver", "Apply failed", e);
            }
            if (!prefs.edit().putString("id", id).putString("report", report.toString())
                .putBoolean("pending", "pending_reboot".equals(report.optString("status")))
                .putInt("boot", boot).putBoolean("rebootIssued", false).putString("command", command.toString())
                .putString("host", host).putInt("port", port).commit())
                throw new IOException("Cannot save command result");
        }
        // ACK before reboot; retry delivery if the network failed. Never reboot twice for one command.
        json(host, port, "/screensaver/report", report);
        if (prefs.getBoolean("pending", false) && boot == prefs.getInt("boot", -1)
            && !prefs.getBoolean("rebootIssued", false)) {
            if (!prefs.edit().putBoolean("rebootIssued", true).commit()) throw new IOException("Cannot save reboot request");
            RootScreensaver.reboot();
        }
    }
    private static JSONObject verifyPending(Context context, SharedPreferences prefs, JSONObject command) throws Exception {
        JSONObject report = new JSONObject().put("id", command.getString("id"));
        try {
            RootScreensaver.verify(context, command.getString("action"), command.optString("apkSha256"),
                new File(context.getFilesDir(), "screensaver/" + command.getString("id") + ".png"));
            report.put("status", "applied").put("message", "image".equals(command.optString("action"))
                ? "已重启，系统屏保资源和图片像素校验通过。请按电源键查看。" : "已重启并恢复系统原屏保。");
            Log.i("MiBookScreensaver", "Verified system resources " + command.getString("id"));
        } catch (Exception e) {
            report.put("status", "error").put("message", e.getMessage());
            Log.e("MiBookScreensaver", "Verification failed", e);
        }
        if (!prefs.edit().putBoolean("pending", false).putString("report", report.toString()).commit())
            throw new IOException("Cannot save verification");
        return report;
    }
    static void finishAfterBoot(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("screensaver_v2", 0);
        if (!prefs.getBoolean("pending", false)) return;
        int boot = Settings.Global.getInt(context.getContentResolver(), "boot_count", -1);
        if (boot < 0 || boot == prefs.getInt("boot", -1)) return;
        try {
            JSONObject command = new JSONObject(prefs.getString("command", "{}"));
            if (!command.optString("id").equals(prefs.getString("id", ""))) return;
            JSONObject report = verifyPending(context, prefs, command);
            JSONObject config = new JSONObject(WifiSync.read(new FileInputStream(new File(context.getFilesDir(), "wifi-config.json"))));
            ScreensaverSync sync = new ScreensaverSync(context, new Handler(android.os.Looper.getMainLooper()), config, null);
            try { sync.json(prefs.getString("host", ""), prefs.getInt("port", config.getInt("port")), "/screensaver/report", report); }
            finally { sync.close(); }
        } catch (Exception e) { Log.w("MiBookScreensaver", "Boot verification/ACK: " + e.getClass().getSimpleName()); }
    }
    private File download(String host, int port, String id, String hash, String kind, String extension) throws Exception {
        File dir = new File(context.getFilesDir(), "screensaver");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create image folder");
        File image = new File(dir, id + extension);
        File temp = new File(dir, id + extension + ".tmp");
        HttpURLConnection c = connection(host, port, "/screensaver/" + kind + "/" + id);
        try {
            if (c.getResponseCode() != 200) throw new IOException("Image unavailable");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(temp)) {
                byte[] bytes = new byte[16384]; int n; int size = 0;
                while ((n = in.read(bytes)) != -1) {
                    size += n;
                    if (size > ("module".equals(kind) ? 96 : 12) * 1024 * 1024) throw new IOException("Image too large");
                    out.write(bytes, 0, n); digest.update(bytes, 0, n);
                }
                out.getFD().sync();
            }
            StringBuilder actual = new StringBuilder();
            for (byte b : digest.digest()) actual.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            if (!hash.equals(actual.toString())) throw new IOException("Image checksum mismatch");
            if ("image".equals(kind)) {
                BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(temp.getAbsolutePath(), bounds);
                if (bounds.outWidth != 1404 || bounds.outHeight != 1872) throw new IOException("Invalid image dimensions");
            }
            if (!temp.renameTo(image)) throw new IOException("Cannot save image");
            return image;
        } finally { c.disconnect(); temp.delete(); }
    }
}
