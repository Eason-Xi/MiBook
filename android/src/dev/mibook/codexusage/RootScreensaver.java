package dev.mibook.codexusage;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.BitmapDrawable;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.zip.*;

/** Narrow root operations: a data-only resource module, its disable flag, and reboot. */
final class RootScreensaver {
    static final String MODULE = "mibook_screensaver";
    static final String PACKAGE = "dev.mibook.screensaver.overlay";
    private static final String APK = "system/vendor/overlay/MiBookScreensaver.apk";
    static String root(String command) throws Exception {
        Process process = new ProcessBuilder("/sbin/su", "-c", command).redirectErrorStream(true).start();
        if (!process.waitFor(40, TimeUnit.SECONDS)) {
            process.destroyForcibly(); throw new IOException("Root 操作超时，请检查 Magisk 授权");
        }
        String output = WifiSync.read(process.getInputStream());
        if (process.exitValue() != 0) throw new IOException("Root 操作失败，请检查 Magisk 授权");
        return output;
    }
    static boolean available() {
        try { return root("id").contains("uid=0("); } catch (Exception e) { return false; }
    }
    static String quote(String s) { return "'" + s.replace("'", "'\\''") + "'"; }
    static String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[16384]; int n;
            while ((n = in.read(bytes)) != -1) digest.update(bytes, 0, n);
        }
        StringBuilder value = new StringBuilder();
        for (byte b : digest.digest()) value.append(String.format(Locale.ROOT, "%02x", b & 255));
        return value.toString();
    }
    static void install(Context context, File module, String apkHash) throws Exception {
        Set<String> allowed = new HashSet<>(Arrays.asList("module.prop", "system/", "system/vendor/",
            "system/vendor/overlay/", APK));
        Set<String> found = new HashSet<>();
        File apk = new File(context.getFilesDir(), "screensaver/check.apk");
        try (ZipFile zip = new ZipFile(module)) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (!allowed.contains(entry.getName()) || !found.add(entry.getName()) || entry.getSize() > 96 * 1024 * 1024)
                    throw new IOException("屏保模块包含非预期文件");
            }
            if (!found.contains(APK) || !found.contains("module.prop")) throw new IOException("屏保模块不完整");
            Properties properties = new Properties();
            try (InputStream in = zip.getInputStream(zip.getEntry("module.prop"))) { properties.load(in); }
            if (!MODULE.equals(properties.getProperty("id"))) throw new IOException("屏保模块标识错误");
            try (InputStream in = zip.getInputStream(zip.getEntry(APK)); OutputStream out = new FileOutputStream(apk)) {
                byte[] bytes = new byte[16384]; int n, size = 0;
                while ((n = in.read(bytes)) != -1) {
                    size += n; if (size > 96 * 1024 * 1024) throw new IOException("屏保资源过大");
                    out.write(bytes, 0, n);
                }
            }
            if (!apkHash.matches("[a-f0-9]{64}") || !hash(apk).equals(apkHash)) throw new IOException("屏保资源校验失败");
            PackageInfo info = context.getPackageManager().getPackageArchiveInfo(apk.getPath(), PackageManager.GET_PERMISSIONS);
            if (info == null || !PACKAGE.equals(info.packageName) || info.applicationInfo == null
                || (info.applicationInfo.flags & ApplicationInfo.FLAG_HAS_CODE) != 0
                || (info.requestedPermissions != null && info.requestedPermissions.length > 0))
                throw new IOException("屏保资源必须是不含代码和权限的指定覆盖包");
        } finally { apk.delete(); }
        String output = root("/sbin/magisk --install-module " + quote(module.getAbsolutePath()));
        if (!output.contains("Done")) throw new IOException("Magisk 未确认安装完成");
    }
    static void disable() throws Exception {
        root("for d in /data/adb/modules/" + MODULE + " /data/adb/modules_update/" + MODULE
            + "; do if [ -d \"$d\" ]; then touch \"$d/disable\" || exit 1; fi; done");
    }
    static void verify(Context context, String action, String apkHash, File reference) throws Exception {
        String overlays = root("/system/bin/cmd overlay list android");
        boolean enabled = overlays.contains("[x] " + PACKAGE);
        File mounted = new File("/vendor/overlay/MiBookScreensaver.apk");
        if (!"image".equals(action)) {
            if (enabled || mounted.exists()) throw new IOException("原屏保尚未恢复，请重启后重试");
            return;
        }
        if (!enabled || !mounted.isFile() || !hash(mounted).equals(apkHash))
            throw new IOException("系统尚未加载本次屏保资源");
        Bitmap expected = BitmapFactory.decodeFile(reference.getPath());
        if (expected == null) throw new IOException("参考图片丢失，请重新发送");
        try {
            Resources resources = context.getResources();
            int[] expectedRow = new int[expected.getWidth()], actualRow = new int[expected.getWidth()];
            for (String name : new String[]{"photo5", "photo5_charging", "photo5_land", "photo6", "photo6_charging", "photo6_land", "photo7", "photo8"}) {
                int id = resources.getIdentifier(name, "drawable", "android");
                BitmapFactory.Options options = new BitmapFactory.Options(); options.inScaled = false;
                Bitmap actual = BitmapFactory.decodeResource(resources, id, options);
                if (actual == null) throw new IOException("系统屏保解码失败：" + name);
                if (actual.getWidth() != expected.getWidth() || actual.getHeight() != expected.getHeight())
                    throw new IOException("系统屏保尺寸校验失败：" + name + " " + actual.getWidth() + "x" + actual.getHeight());
                try { for (int y = 0; y < expected.getHeight(); y++) {
                    expected.getPixels(expectedRow, 0, expectedRow.length, 0, y, expectedRow.length, 1);
                    actual.getPixels(actualRow, 0, actualRow.length, 0, y, actualRow.length, 1);
                    if (!Arrays.equals(expectedRow, actualRow)) throw new IOException("系统屏保像素校验失败：" + name);
                } } finally { actual.recycle(); }
            }
        } finally { expected.recycle(); }
    }
    static void reboot() throws Exception { root("/system/bin/reboot"); }
}
