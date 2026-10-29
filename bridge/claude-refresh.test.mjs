import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { refreshClaude } from './claude-refresh.mjs';

test('active refresh drives /usage over a real PTY and persists only returned quota', async () => {
  const dir = await mkdtemp(tmpdir() + '/mibook-refresh-');
  const cli = dir + '/fake-claude';
  await writeFile(cli, `#!/usr/bin/python3
import os, sys, json, time
if sys.argv[1:] == ['auth', 'status']:
    print(json.dumps({'loggedIn': True})); sys.exit(0)
print("Claude Code ❯", flush=True)
command = sys.stdin.readline().strip()
open(os.path.dirname(sys.argv[0]) + '/received.txt', 'w').write(command)
if command != '/usage': sys.exit(2)
print("Current session\\r\\n21% used\\r\\nResets 1:10pm (Asia/Taipei)\\r\\nCurrent week (all models)\\r\\n73% used\\r\\nResets Oct 31 at 12am (Asia/Taipei)", flush=True)
time.sleep(30)
`, {mode: 0o700});
  try {
    const value = await refreshClaude(dir, {claude: cli});
    assert.equal(await readFile(dir + '/received.txt', 'utf8'), '/usage');
    assert.equal(value.primary.usedPercent, 21);
    assert.equal(value.secondary.usedPercent, 73);
    assert.equal(value.primary.windowDurationMins, 300);
    assert.equal(value.secondary.windowDurationMins, 10080);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('CLI startup failure preserves previous Claude cache instead of stamping it fresh', async () => {
  const dir = await mkdtemp(tmpdir() + '/mibook-refresh-');
  try {
    const cached = '{"updatedAt":123,"primary":null,"secondary":null}';
    await writeFile(dir + '/claude-usage.json', cached);
    await assert.rejects(refreshClaude(dir, {claude: '/nonexistent/mibook-claude'}));
    assert.equal(await readFile(dir + '/claude-usage.json', 'utf8'), cached);
  } finally { await rm(dir, {recursive: true, force: true}); }
});


test('signed-out Claude fails promptly without starting an interactive query or changing cache', async () => {
  const dir = await mkdtemp(tmpdir() + '/mibook-refresh-');
  const cli = dir + '/fake-claude';
  await writeFile(cli, `#!/usr/bin/python3
import sys, json
if sys.argv[1:] == ['auth', 'status']:
    print(json.dumps({'loggedIn': False, 'authMethod': 'none'})); sys.exit(1)
sys.exit(99)
`, {mode: 0o700});
  try {
    const cached = '{"updatedAt":123,"primary":null,"secondary":null}';
    await writeFile(dir + '/claude-usage.json', cached);
    await assert.rejects(refreshClaude(dir, {claude: cli}), /signed out/);
    assert.equal(await readFile(dir + '/claude-usage.json', 'utf8'), cached);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
