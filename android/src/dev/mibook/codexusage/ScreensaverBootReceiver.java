package dev.mibook.codexusage;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Resume only the user-requested screensaver transaction after its reboot. */
public final class ScreensaverBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
            && context.getSharedPreferences("screensaver_v2", 0).getBoolean("pending", false)) {
            final PendingResult result = goAsync();
            final Context app = context.getApplicationContext();
            new Thread(() -> {
                try { ScreensaverSync.finishAfterBoot(app); }
                finally { result.finish(); }
            }, "screensaver-boot-check").start();
        }
    }
}
