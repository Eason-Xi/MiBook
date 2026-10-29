import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './usage.mjs';

test('uses Codex bucket, preserves reset timestamps, and omits identity and credentials', () => {
  const value = normalize({ accountId: 'private', rateLimits: { limitId: 'other' },
    rateLimitsByLimitId: { codex: { limitId: 'codex', planType: 'plus',
      primary: { usedPercent: 17, windowDurationMins: 300, resetsAt: 1234 }, secondary: null } } }, 99);
  assert.equal(value.primary.usedPercent, 17);
  assert.equal(value.primary.resetsAt, 1234);
  assert.equal(value.updatedAt, 99);
  assert.equal(value.secondary, null);
  assert.equal('accountId' in value, false);
});
test('missing data stays unknown and percentages stay within range', () => {
  const value = normalize({rateLimits: { primary: {usedPercent: null}, secondary: {usedPercent: 110} }});
  assert.equal(value.primary, null);
  assert.equal(value.secondary.usedPercent, 100);
  assert.equal(value.secondary.resetsAt, null);
  assert.throws(() => normalize({rateLimits: {limitId: 'other'}}));
});
