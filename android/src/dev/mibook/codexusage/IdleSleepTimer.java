package dev.mibook.codexusage;

/** Counts foreground user inactivity, independently of firmware display refreshes. */
final class IdleSleepTimer {
    interface Scheduler {
        void postDelayed(Runnable task, long delay);
        void removeCallbacks(Runnable task);
    }
    private final Scheduler scheduler;
    private final long timeout;
    private final Runnable sleep;
    private boolean active;
    private boolean enabled;
    private long generation;
    private Runnable pending;

    IdleSleepTimer(Scheduler scheduler, long timeout, Runnable sleep) {
        this.scheduler = scheduler;
        this.timeout = timeout;
        this.sleep = sleep;
    }
    void setActive(boolean value) {
        if (active == value) return;
        active = value;
        restart();
    }
    void setEnabled(boolean value) {
        enabled = value;
        restart();
    }
    void userActivity() { restart(); }
    private void restart() {
        final long expected = ++generation;
        if (pending != null) scheduler.removeCallbacks(pending);
        pending = null;
        if (!active || !enabled) return;
        pending = () -> {
            if (generation != expected || !active || !enabled) return;
            pending = null;
            sleep.run();
        };
        scheduler.postDelayed(pending, timeout);
    }
}
