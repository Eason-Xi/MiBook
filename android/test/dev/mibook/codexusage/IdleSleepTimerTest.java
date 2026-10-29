package dev.mibook.codexusage;

import java.util.ArrayList;
import java.util.List;

/** Run with scripts/test-android.sh; uses a monotonic virtual clock, no device needed. */
public final class IdleSleepTimerTest {
    private static final long TIMEOUT = 300000L;
    private static final class Clock implements IdleSleepTimer.Scheduler {
        long now;
        int sleeps;
        final List<Runnable> tasks = new ArrayList<>();
        final List<Long> deadlines = new ArrayList<>();
        final IdleSleepTimer timer = new IdleSleepTimer(this, TIMEOUT, () -> sleeps++);
        public void postDelayed(Runnable task, long delay) { tasks.add(task); deadlines.add(now + delay); }
        public void removeCallbacks(Runnable task) {
            int i = tasks.indexOf(task);
            if (i >= 0) { tasks.remove(i); deadlines.remove(i); }
        }
        void advance(long milliseconds) {
            now += milliseconds;
            while (!tasks.isEmpty() && deadlines.get(0) <= now) {
                Runnable task = tasks.remove(0); deadlines.remove(0); task.run();
            }
        }
        void enable() { timer.setEnabled(true); timer.setActive(true); }
    }
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        Clock clock = new Clock();
        clock.enable();
        // Minute ticks / network callbacks do not call userActivity or re-arm the timer.
        for (int i = 0; i < 4; i++) {
            clock.advance(60000); clock.timer.setActive(true);
            check(clock.sleeps == 0, "must wait five minutes");
        }
        clock.advance(60000);
        check(clock.sleeps == 1, "must sleep despite periodic redraws");
        clock.advance(TIMEOUT);
        check(clock.sleeps == 1, "sleep request must be one-shot");

        clock = new Clock(); clock.enable(); clock.advance(240000);
        Runnable obsolete = clock.tasks.get(0);
        clock.timer.userActivity(); obsolete.run(); clock.advance(60000);
        check(clock.sleeps == 0, "touch cancels the old deadline, including stale callbacks");
        clock.advance(240000);
        check(clock.sleeps == 1, "touch starts a new five-minute interval");

        clock = new Clock(); clock.enable(); clock.advance(240000);
        obsolete = clock.tasks.get(0); clock.timer.setEnabled(false); obsolete.run();
        clock.advance(TIMEOUT * 2);
        check(clock.sleeps == 0, "disabled switch cancels sleep");
        clock.timer.setEnabled(true); clock.advance(TIMEOUT - 1);
        check(clock.sleeps == 0, "re-enabling starts a full interval");
        clock.advance(1); check(clock.sleeps == 1, "re-enabled switch works");

        clock = new Clock(); clock.enable(); clock.advance(240000);
        obsolete = clock.tasks.get(0); clock.timer.setActive(false); obsolete.run();
        clock.advance(TIMEOUT);
        check(clock.sleeps == 0, "leaving the dashboard cancels sleep");
        clock.timer.setActive(true); clock.advance(TIMEOUT - 1);
        check(clock.sleeps == 0, "resume/wake starts a full interval");
        clock.advance(1); check(clock.sleeps == 1, "resume/wake restores auto sleep");

        clock = new Clock(); clock.timer.setActive(true); clock.advance(TIMEOUT * 2);
        check(clock.sleeps == 0, "auto sleep defaults to disabled");
        System.out.println("IdleSleepTimer: all checks passed");
    }
}
