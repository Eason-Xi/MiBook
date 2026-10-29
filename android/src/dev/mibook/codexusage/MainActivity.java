package dev.mibook.codexusage;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.PowerManager;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.view.View;
import android.view.MotionEvent;
import android.view.WindowManager;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.concurrent.TimeUnit;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private final Handler handler = new Handler();
    private Dashboard dashboard;
    private JSONObject data;
    private String raw = "";
    private boolean readError = false;
    private WifiSync wifi;
    private boolean wifiError = false;
    private boolean wifiConnected = false;
    private boolean autoSleep = false;
    private boolean sleepPolicyError = false;
    private boolean landscape = false;
    private boolean resumed;
    private volatile long sleepRequestGeneration;
    private final IdleSleepTimer idleSleep = new IdleSleepTimer(new IdleSleepTimer.Scheduler() {
        public void postDelayed(Runnable task, long delay) { handler.postDelayed(task, delay); }
        public void removeCallbacks(Runnable task) { handler.removeCallbacks(task); }
    }, 300000L, () -> requestIdleSleep());
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            load();
            // Align to wall-clock minute boundaries so HH:mm advances promptly.
            handler.postDelayed(this, 60000 - System.currentTimeMillis() % 60000);
        }
    };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        autoSleep = getSharedPreferences("display", 0).getBoolean("autoSleep", false);
        landscape = getSharedPreferences("display", 0).getBoolean("landscape", false);
        setRequestedOrientation(landscape ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        dashboard = new Dashboard(this);
        dashboard.setBackgroundColor(Color.WHITE);
        setContentView(dashboard);
        wifi = new WifiSync(this, handler, success -> {
            wifiConnected = success;
            wifiError = !success;
            load();
        });
        applySleepPolicy();
    }
    @Override public void onResume() {
        super.onResume();
        resumed = true;
        applySleepPolicy();
        idleSleep.setActive(hasWindowFocus());
        dashboard.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        handler.removeCallbacks(tick);
        wifi.start();
        tick.run();
    }
    @Override public void onPause() {
        resumed = false;
        sleepRequestGeneration++;
        idleSleep.setActive(false);
        super.onPause(); handler.removeCallbacks(tick); wifi.stop();
    }
    @Override public void onDestroy() { wifi.close(); super.onDestroy(); }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        sleepRequestGeneration++;
        idleSleep.setActive(resumed && focused);
    }
    @Override public void onUserInteraction() {
        super.onUserInteraction();
        sleepRequestGeneration++;
        idleSleep.userActivity();
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        dashboard.invalidate();
    }
    private void toggleOrientation() {
        landscape = !landscape;
        getSharedPreferences("display", 0).edit().putBoolean("landscape", landscape).apply();
        setRequestedOrientation(landscape ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        dashboard.invalidate();
    }
    private void load() {
        try {
            File dir = getExternalFilesDir(null);
            if (dir == null) throw new Exception("Storage unavailable");
            File file = new File(getFilesDir(), "usage-cache.json");
            if (!file.exists()) file = new File(dir, "usage.json");
            try (FileInputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096];
                int count;
                while ((count = in.read(buf)) != -1) {
                    out.write(buf, 0, count);
                    if (out.size() > 65536) throw new Exception("Invalid data size");
                }
                String value = out.toString("UTF-8");
                if (!raw.equals(value)) {
                    JSONObject next = new JSONObject(value);
                    if (next.optInt("schemaVersion") != 1 || next.optLong("updatedAt") <= 0) throw new Exception("Invalid data");
                    data = next;
                    raw = value;
                }
                readError = false;
            }
        } catch (Exception e) { readError = true; }
        dashboard.setContentDescription(date(System.currentTimeMillis(), "yyyy年MM月dd日 EEEE HH:mm")
            + "。Codex 和 Claude 用量。" + accessibleWindow("primary") + "。" + accessibleWindow("secondary"));
        dashboard.invalidate();
    }
    private void applySleepPolicy() {
        sleepRequestGeneration++;
        idleSleep.setEnabled(autoSleep);
        if (autoSleep) getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        try {
            // Android 8.1 supports a per-window idle timeout; leave the global setting untouched.
            WindowManager.LayoutParams params = getWindow().getAttributes();
            WindowManager.LayoutParams.class.getField("userActivityTimeout").setLong(params, autoSleep ? 300000L : -1L);
            getWindow().setAttributes(params);
            sleepPolicyError = false;
            android.util.Log.i("MiBookUsage", "Auto sleep " + (autoSleep ? "ON, idle timeout 300000ms" : "OFF, keep screen on"));
        } catch (Exception e) {
            sleepPolicyError = true;
            android.util.Log.e("MiBookUsage", "Cannot apply idle timeout", e);
        }
    }
    private void requestIdleSleep() {
        final long expected = ++sleepRequestGeneration;
        android.util.Log.i("MiBookUsage", "Foreground idle timeout reached; requesting system sleep");
        new Thread(() -> {
            Process process = null;
            Runnable timeout = null;
            try {
                // Wait for root to be ready, then recheck foreground/user activity on the UI thread.
                // Never send POWER (a toggle): SLEEP is safe if the device is already asleep.
                process = new ProcessBuilder("/sbin/su", "-c",
                    "echo MIBOOK_SLEEP_READY; read action; [ \"$action\" = sleep ] && exec /system/bin/input keyevent 223")
                    .redirectErrorStream(true).start();
                final Process request = process;
                timeout = () -> request.destroy();
                handler.postDelayed(timeout, 10000L);
                BufferedReader output = new BufferedReader(new InputStreamReader(process.getInputStream(), "UTF-8"));
                if (!"MIBOOK_SLEEP_READY".equals(output.readLine())) throw new Exception("Root sleep unavailable");
                handler.post(() -> {
                    if (expected != sleepRequestGeneration || !resumed || !hasWindowFocus() || !autoSleep) {
                        request.destroy(); return;
                    }
                    try {
                        request.getOutputStream().write("sleep\n".getBytes("UTF-8"));
                        request.getOutputStream().flush();
                        request.getOutputStream().close();
                    } catch (Exception e) { request.destroy(); }
                });
                if (!process.waitFor(10, TimeUnit.SECONDS) || process.exitValue() != 0)
                    throw new Exception("System sleep command failed");
                handler.post(() -> {
                    PowerManager power = (PowerManager)getSystemService(POWER_SERVICE);
                    if (expected == sleepRequestGeneration && resumed && power.isInteractive()) {
                        sleepPolicyError = true;
                        dashboard.invalidate();
                        android.util.Log.e("MiBookUsage", "System remained awake after sleep request");
                    }
                });
            } catch (Exception e) {
                android.util.Log.e("MiBookUsage", "Cannot request system sleep; check Magisk authorization", e);
                handler.post(() -> {
                    if (expected != sleepRequestGeneration || !resumed || !autoSleep) return;
                    sleepPolicyError = true;
                    dashboard.invalidate();
                });
            } finally {
                if (timeout != null) handler.removeCallbacks(timeout);
                if (process != null) process.destroy();
            }
        }, "MiBookAutoSleep").start();
    }
    private String accessibleWindow(String key) {
        JSONObject w = data == null ? null : data.optJSONObject(key);
        return w == null ? "暂无数据" : "剩余 " + Math.round(100 - w.optDouble("usedPercent", 0)) + "%";
    }
    private String date(long timestamp, String pattern) {
        SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.SIMPLIFIED_CHINESE);
        format.setTimeZone(TimeZone.getTimeZone("Asia/Taipei"));
        return format.format(new Date(timestamp));
    }
    private String until(long seconds) {
        long minutes = (long)Math.ceil((seconds * 1000 - System.currentTimeMillis()) / 60000.0);
        if (minutes <= 0) return "已到重置时间，等待更新";
        if (minutes >= 1440) return (minutes / 1440) + " 天 " + ((minutes % 1440) / 60) + " 小时后重置";
        if (minutes >= 60) return (minutes / 60) + " 小时 " + (minutes % 60) + " 分钟后重置";
        return minutes + " 分钟后重置";
    }
    private class Dashboard extends View {
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        Dashboard(Context c) { super(c); setFocusable(true); setClickable(true); }
        private int designWidth() { return landscape ? 1872 : 1404; }
        private int designHeight() { return landscape ? 1404 : 1872; }
        private void text(Canvas c, String text, float x, float y, float size, boolean bold) {
            paint.setColor(Color.BLACK); paint.setStyle(Paint.Style.FILL); paint.setTextSize(size);
            paint.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
            c.drawText(text, x, y, paint);
        }
        private void textRight(Canvas c, String value, float right, float y, float size, boolean bold) {
            paint.setTextSize(size);
            paint.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
            text(c, value, right - paint.measureText(value), y, size, bold);
        }
        private void textCentered(Canvas c, String value, float center, float y, float size, boolean bold) {
            paint.setTextSize(size);
            paint.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
            text(c, value, center - paint.measureText(value) / 2, y, size, bold);
        }
        private void line(Canvas c, float y) {
            paint.setColor(Color.BLACK); paint.setStrokeWidth(2); c.drawLine(96, y, designWidth() - 96, y, paint);
        }
        private void button(Canvas c, float left, float top, float right, float bottom, String label, float size) {
            paint.setColor(Color.BLACK); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(2);
            c.drawRect(left, top, right, bottom, paint);
            paint.setStyle(Paint.Style.FILL); paint.setTextSize(size);
            paint.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
            c.drawText(label, (left + right - paint.measureText(label)) / 2, (top + bottom - paint.ascent() - paint.descent()) / 2, paint);
        }
        private String label(JSONObject w, String fallback) {
            int mins = w == null ? 0 : w.optInt("windowDurationMins");
            if (mins == 10080) return "每周额度";
            if (mins > 0 && mins % 60 == 0) return (mins / 60) + " 小时额度";
            if (mins > 0) return mins + " 分钟额度";
            return fallback;
        }
        private void window(Canvas c, String key, String fallback, String english, int top, int left, int width) {
            JSONObject w = data == null ? null : data.optJSONObject(key);
            text(c, label(w, fallback), left, top, 52, true);
            text(c, english, left + width - 180, top, 28, true);
            if (w == null || w.isNull("usedPercent")) {
                text(c, "—", left - 6, top + 226, 220, true);
                text(c, "暂无额度数据", left, top + 365, 40, false);
                return;
            }
            int remaining = (int)Math.round(Math.max(0, Math.min(100, 100 - w.optDouble("usedPercent"))));
            String number = String.valueOf(remaining);
            text(c, number, left - 14, top + 225, 252, true);
            float numberWidth = paint.measureText(number);
            text(c, "%", left + 4 + numberWidth, top + 220, 95, true);
            text(c, "剩余", left + width - 160, top + 208, 44, false);
            float step = width / 40f;
            for (int i = 0; i < 40; i++) {
                float x = left + i * step;
                paint.setColor(Color.BLACK); paint.setStrokeWidth(2);
                paint.setStyle(i < (int)Math.round(remaining / 2.5) ? Paint.Style.FILL : Paint.Style.STROKE);
                c.drawRect(x, top + 275, x + step - (landscape ? 5 : 8), top + 315, paint);
            }
            paint.setStyle(Paint.Style.FILL);
            long resets = w.optLong("resetsAt", 0);
            text(c, resets > 0 ? until(resets) : "重置时间暂未提供", left, top + 385, 42, false);
            text(c, resets > 0 ? "重置于 " + date(resets * 1000, "MM 月 dd 日  HH:mm") : "", left, top + 445, 33, false);
        }
        private int centeredQuotaBaseline(int topLine, int bottomLine) {
            paint.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
            paint.setTextSize(landscape ? 35 : 37);
            float titleAscent = -paint.ascent();
            paint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
            paint.setTextSize(32);
            float bottomOffset = (landscape ? 120 : 180) + 27 + (landscape ? 105 : 119) + paint.descent();
            return Math.round((topLine + bottomLine + titleAscent - bottomOffset) / 2f);
        }
        private void quotaCard(Canvas c, JSONObject provider, String key, String title, int left, int top, int width) {
            JSONObject w = provider == null ? null : provider.optJSONObject(key);
            int numberSize = landscape ? 130 : 164;
            int valueY = top + (landscape ? 120 : 180);
            text(c, title, left, top, landscape ? 35 : 37, true);
            boolean known = w != null && !w.isNull("usedPercent");
            String number = known ? String.valueOf((int)Math.round(Math.max(0, Math.min(100, 100 - w.optDouble("usedPercent"))))) : "—";
            text(c, number, left - 6, valueY, numberSize, true);
            float numberWidth = paint.measureText(number);
            if (known) text(c, "%", left + numberWidth, valueY - 4, 55, true);
            textRight(c, known ? "剩余" : "暂无数据", left + width, valueY - 6, 28, false);
            int barY = valueY + 27;
            if (known) {
                double remaining = Math.max(0, Math.min(100, 100 - w.optDouble("usedPercent")));
                for (int i = 0; i < 20; i++) {
                    float x = left + i * width / 20f;
                    paint.setColor(Color.BLACK); paint.setStrokeWidth(2);
                    paint.setStyle(i < Math.round(remaining / 5) ? Paint.Style.FILL : Paint.Style.STROKE);
                    c.drawRect(x, barY, x + width / 20f - 5, barY + 23, paint);
                }
                paint.setStyle(Paint.Style.FILL);
            }
            long reset = w == null ? 0 : w.optLong("resetsAt", 0);
            text(c, reset > 0 ? until(reset) : (known ? "重置时间暂未提供" : "等待 " + (title.startsWith("Claude") ? "Claude 会话" : "Mac") + "提供数据"), left, barY + (landscape ? 65 : 74), reset > 0 ? (landscape ? 39 : 42) : (landscape ? 26 : 29), false);
            text(c, reset > 0 ? "重置 " + date(reset * 1000, "MM/dd HH:mm") : "", left, barY + (landscape ? 105 : 119), 32, false);
        }
        @Override protected void onDraw(Canvas c) {
            super.onDraw(c);
            c.drawColor(Color.WHITE);
            int width = designWidth(), height = designHeight();
            float scale = Math.min(getWidth() / (float)width, getHeight() / (float)height);
            c.save();
            c.translate((getWidth() - width * scale) / 2f, (getHeight() - height * scale) / 2f);
            c.scale(scale, scale);
            text(c, "C O D E X  +  C L A U D E", 96, 120, 34, true);
            button(c, width - 406, 70, width - 96, 150, landscape ? "切换竖屏" : "切换横屏", 32);
            text(c, "用量看板", 92, 244, 86, true);
            long clockTime = System.currentTimeMillis();
            textCentered(c, date(clockTime, "HH:mm"), width / 2f, 220, 150, true);
            textCentered(c, date(clockTime, "yyyy/MM/dd  EEEE"), width / 2f, 286, 45, false);
            text(c, "AI 订阅额度", 96, 308, 28, false);
            line(c, 350);
            JSONObject claude = data == null ? null : data.optJSONObject("claude");
            int gap = 90, cardWidth = (width - 192 - gap) / 2;
            int right = 96 + cardWidth + gap;
            int divider = landscape ? 680 : 884;
            int footer = landscape ? 1030 : 1558;
            int firstRow = centeredQuotaBaseline(350, divider);
            int secondRow = centeredQuotaBaseline(divider, footer);
            quotaCard(c, data, "primary", "Codex · 5 小时额度", 96, firstRow, cardWidth);
            quotaCard(c, data, "secondary", "Codex · 每周额度", right, firstRow, cardWidth);
            line(c, divider);
            quotaCard(c, claude, "primary", "Claude · 5 小时额度", 96, secondRow, cardWidth);
            quotaCard(c, claude, "secondary", "Claude · 每周额度", right, secondRow, cardWidth);
            line(c, footer);
            long updated = data == null ? 0 : data.optLong("updatedAt", 0);
            boolean stale = updated <= 0 || System.currentTimeMillis() - updated > 10 * 60000L;
            text(c, updated > 0 ? "Codex 更新 " + date(updated, "MM/dd HH:mm") : "等待 Mac 首次同步", 96, footer + 74, 36, true);
            long claudeUpdated = claude == null ? 0 : claude.optLong("updatedAt", 0);
            boolean claudeStale = claudeUpdated > 0 && (System.currentTimeMillis() - claudeUpdated > 10 * 60000L || data.optBoolean("claudeError", false));
            text(c, claudeUpdated > 0 ? (claudeStale ? "Claude 旧数据 " : "Claude 更新 ") + date(claudeUpdated, "MM/dd HH:mm") : "Claude：等待 Mac 读取额度", 96, footer + 125, 35, false);
            String status = "正在通过 Wi-Fi 连接 Mac…";
            if (wifiConnected) status = stale || readError ? "Wi-Fi 已连接 · 等待 Mac 更新用量"
                : "Wi-Fi 已连接 · 下次同步 " + date((System.currentTimeMillis() / 300000 + 1) * 300000, "HH:mm");
            if (wifiError) status = "连接不到 Mac · 保留上次数据";
            if (wifi != null && !wifi.paired()) status = "等待 Wi-Fi 配对，请连接 Mac";
            if (data != null && Boolean.FALSE.equals(data.opt("ordinaryUsageAllowed"))) status = "账户额度受限，请在 Mac 查看详情";
            if (data != null && data.optBoolean("codexError", false)) status = "Codex 暂不可用 · 保留最近数据";
            if (wifiConnected && data != null && data.optBoolean("claudeError", false)) status = "Claude 刷新失败 · 保留最近数据";
            text(c, status, 96, footer + 176, 34, false);
            text(c, sleepPolicyError ? "自动休眠设置失败，请重试" : (autoSleep ? "闲置 5 分钟自动休眠" : "自动休眠已关闭 · 保持显示"), 96, height - 88, 27, false);
            button(c, width - 749, height - 140, width - 434, height - 52, autoSleep ? "自动休眠：开" : "自动休眠：关", 32);
            button(c, width - 389, height - 140, width - 96, height - 52, wifi != null && wifi.busy() ? "同步中…" : "立即同步", 36);
            c.restore();
        }
        @Override public boolean onTouchEvent(MotionEvent event) {
            if (event.getAction() == MotionEvent.ACTION_UP) {
                int width = designWidth(), height = designHeight();
                float scale = Math.min(getWidth() / (float)width, getHeight() / (float)height);
                float x = (event.getX() - (getWidth() - width * scale) / 2f) / scale;
                float y = (event.getY() - (getHeight() - height * scale) / 2f) / scale;
                if (x >= width - 406 && x <= width - 96 && y >= 70 && y <= 150) {
                    performClick(); toggleOrientation(); return true;
                }
                if (y >= height - 140 && y <= height - 52) {
                    if (x >= width - 389 && x <= width - 96) { performClick(); wifi.fetch(true); invalidate(); }
                    if (x >= width - 749 && x <= width - 434) {
                        performClick(); autoSleep = !autoSleep;
                        getSharedPreferences("display", 0).edit().putBoolean("autoSleep", autoSleep).apply();
                        applySleepPolicy();
                        invalidate();
                    }
                }
            }
            return true;
        }
        @Override public boolean performClick() { super.performClick(); return true; }
    }
}
