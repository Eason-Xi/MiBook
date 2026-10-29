import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { normalizeClaude, saveClaude, readClaude } from './claude.mjs';

test('Claude percentages use the official 0–100 units and retain reset seconds', () => {
  const result = normalizeClaude({ rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1800000000 },
    seven_day: { used_percentage: 0, resets_at: 1800500000 },
  }, session_id: 'private', transcript_path: 'private' }, 123);
  assert.deepEqual(result, { updatedAt: 123,
    primary: { usedPercent: 23.5, windowDurationMins: 300, resetsAt: 1800000000 },
    secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1800500000 } });
});
test('missing and corrupt Claude windows stay unknown, including epoch-as-percentage bug', () => {
  for (const used_percentage of [null, '15', NaN, -1, 1800000000]) {
    assert.equal(normalizeClaude({rate_limits: {five_hour: {used_percentage}}}), null);
  }
  assert.equal(normalizeClaude({}), null);
  assert.equal(normalizeClaude({rate_limits: {seven_day: {used_percentage: 100}}}).primary, null);
});
test('collector persists only quota data; missing events preserve last observation', async () => {
  const dir = await mkdtemp(tmpdir() + '/mibook-claude-');
  try {
    assert.equal(await readClaude(dir), null);
    await saveClaude({rate_limits: {five_hour: {used_percentage: 12}}, session_id: 'secret'}, dir);
    const before = await readFile(dir + '/claude-usage.json', 'utf8');
    await saveClaude({}, dir);
    assert.equal(await readFile(dir + '/claude-usage.json', 'utf8'), before);
    assert.equal(before.includes('secret'), false);
    assert.equal((await readClaude(dir)).primary.usedPercent, 12);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
