import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUsageScreen} from './claude-usage-screen.mjs';
const now = Date.parse('2026-10-29T03:10:00Z');
const pane = '\x1b[32mCurrent session\r\n21% used\r\nResets 1:10pm (Asia/Taipei)\r\nCurrent week (all models)\r\n73% used\r\nResets Oct 31 at 12am (Asia/Taipei)';
test('/usage percentages and Taipei reset dates survive terminal formatting', () => {
  const v = parseUsageScreen(pane, now).rate_limits;
  assert.equal(v.five_hour.used_percentage, 21);
  assert.equal(v.five_hour.resets_at, Date.parse('2026-10-29T05:10:00Z')/1000);
  assert.equal(v.seven_day.used_percentage, 73);
  assert.equal(v.seven_day.resets_at, Date.parse('2026-10-30T16:00:00Z')/1000);
});
test('partial and unavailable quota output stays unknown', () => {
  assert.equal(parseUsageScreen('Not logged in', now), null);
  assert.equal(parseUsageScreen(pane.replace('21% used', 'unavailable'), now), null);
  assert.equal(parseUsageScreen(pane.split('Current week')[0], now), null);
  assert.equal(parseUsageScreen(pane.replace('21%', '121%'), now), null);
  assert.equal(parseUsageScreen(pane.replace('1:10pm', 'tomorrow'), now).rate_limits.five_hour.resets_at, null);
});
