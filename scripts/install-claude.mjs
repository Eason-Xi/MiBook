import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configDir = process.env.CLAUDE_CONFIG_DIR || resolve(homedir(), '.claude');
const settingsFile = resolve(configDir, 'settings.json');
await mkdir(configDir, { recursive: true });
await mkdir(resolve(root, '.state'), { recursive: true, mode: 0o700 });
let settings = {};
try { settings = JSON.parse(await readFile(settingsFile, 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const quote = s => "'" + s.replace(/'/g, "'\\''") + "'";
const command = quote(process.execPath) + ' ' + quote(resolve(root, 'bridge/claude-statusline.mjs'));
if (settings.statusLine?.command !== command) {
  try { await copyFile(settingsFile, resolve(root, '.state/claude-settings-backup-' + Date.now() + '.json')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  await writeFile(resolve(root, '.state/claude-statusline-original.json'), JSON.stringify(settings.statusLine ?? null), { mode: 0o600 });
  settings.statusLine = { ...(settings.statusLine ?? {}), type: 'command', command };
  await writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
}
console.log('Claude Code usage collector installed; existing status line preserved.');
