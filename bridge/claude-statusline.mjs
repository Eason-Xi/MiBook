import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { saveClaude } from './claude.mjs';

const stateDir = process.env.MIBOOK_CLAUDE_STATE_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../.state');
let raw = '';
for await (const chunk of process.stdin) {
  raw += chunk;
  if (raw.length > 1024 * 1024) process.exit(0);
}
try {
  const input = JSON.parse(raw);
  const value = await saveClaude(input, stateDir);
  let previous;
  try { previous = JSON.parse(await readFile(stateDir + '/claude-statusline-original.json', 'utf8')); } catch {}
  if (previous?.type === 'command' && previous.command) {
    const result = spawnSync('/bin/sh', ['-c', previous.command], {
      input: raw, encoding: 'utf8', timeout: 1500, maxBuffer: 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
  } else {
    const remaining = w => w ? Math.round(100 - w.usedPercent) + '%' : '—';
    console.log('Claude · 5h ' + remaining(value?.primary) + ' · Weekly ' + remaining(value?.secondary));
  }
} catch { /* A status line must not interrupt Claude Code. */ }
