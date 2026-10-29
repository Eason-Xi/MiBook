export const SYNC_INTERVAL_MS = 5 * 60_000;

// Wall-clock slots: xx:00, xx:05, ... xx:55, independent of prior requests.
export function nextSyncAt(now = Date.now()) {
  return (Math.floor(now / SYNC_INTERVAL_MS) + 1) * SYNC_INTERVAL_MS;
}
