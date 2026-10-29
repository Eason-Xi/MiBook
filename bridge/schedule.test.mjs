import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSyncAt } from './schedule.mjs';

test('sync aligns to five-minute clock slots and rolls over the hour', () => {
  for (const [now, expected] of [
    ['2026-10-26T13:29:59.999+08:00', '2026-10-26T13:30:00+08:00'],
    ['2026-10-26T13:30:00+08:00', '2026-10-26T13:35:00+08:00'],
    ['2026-10-26T13:32:17+08:00', '2026-10-26T13:35:00+08:00'],
    ['2026-10-26T23:59:59+08:00', '2026-10-27T00:00:00+08:00'],
  ]) assert.equal(nextSyncAt(Date.parse(now)), Date.parse(expected));
});
