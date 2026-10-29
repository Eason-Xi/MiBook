import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { readRateLimits } from './codex.mjs';
import { pairing, usageServer } from './wifi.mjs';
import { nextSyncAt } from './schedule.mjs';
import { readClaude } from './claude.mjs';
import { refreshClaude } from './claude-refresh.mjs';
import { screensaverRoutes } from './screensaver.mjs';
import { prepareOverlay } from './screensaver-overlay.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = resolve(root, '.state');
await mkdir(stateDir, {recursive: true, mode: 0o700});
await chmod(stateDir, 0o700);
const config = await pairing(stateDir);
let snapshot = null;
try { snapshot = JSON.parse(await readFile(stateDir + '/usage.json', 'utf8')); } catch {}
let pending = null;
let lastAttempt = 0;
let lastError = null;
const log = value => console.log(new Date().toISOString(), value);

async function refresh() {
  if (pending) return pending;
  // Coalesce manual requests and limit upstream reads to once per 30 seconds.
  if (Date.now() - lastAttempt < 30_000) {
    if (lastError) throw lastError;
    return;
  }
  lastAttempt = Date.now();
  pending = (async () => {
    try {
      const [codex, claude] = await Promise.allSettled([readRateLimits(), refreshClaude(stateDir)]);
      if (claude.status === 'rejected') log('Claude refresh failed: ' + claude.reason.message);
      const previous = snapshot;
      const claudeData = claude.status === 'fulfilled' ? claude.value : await readClaude(stateDir);
      if (codex.status === 'rejected' && !previous && !claudeData) throw codex.reason;
      const value = codex.status === 'fulfilled' ? codex.value : {
        ...(previous ?? {schemaVersion: 1, updatedAt: Date.now(), primary: null, secondary: null}),
      };
      value.codexError = codex.status === 'rejected';
      value.claude = claudeData ?? previous?.claude ?? null;
      value.claudeError = claude.status === 'rejected';
      await writeFile(stateDir + '/usage.json.tmp', JSON.stringify(value), {mode: 0o600});
      await rename(stateDir + '/usage.json.tmp', stateDir + '/usage.json');
      snapshot = value;
      lastError = null;
      log('Usage updated: Codex ' + (value.codexError ? 'unavailable' : 'OK') + ', Claude ' + (value.claudeError ? 'refresh failed; cached data' : 'OK'));
    } catch (error) { lastError = error; throw error; }
  })();
  try { await pending; } finally { pending = null; }
}
if (process.argv.includes('--once')) {
  await refresh();
  log('Usage snapshot saved on Mac');
} else {
  const screensaver = await screensaverRoutes(stateDir, {prepareOverlay});
  const server = usageServer({token: config.token, snapshot: () => snapshot, refresh, screensaver, log});
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.on('error', error => { console.error('Wi-Fi server:', error.message); process.exit(1); });
  server.listen(config.port, '0.0.0.0', () => log('Wi-Fi sync listening on port ' + config.port));
  const bonjour = spawn('/usr/bin/dns-sd', ['-R', config.serviceName, '_mibookusage._tcp', 'local', String(config.port)],
    {stdio: 'ignore'});
  bonjour.on('error', () => log('Bonjour unavailable; use paired IP address'));
  let timer;
  const scheduleNext = () => {
    const target = nextSyncAt();
    log('Next clock-slot sync: ' + new Date(target).toISOString());
    timer = setTimeout(() => {
      scheduleNext();
      log('Clock-slot sync fired');
      refresh().catch(e => log(e.message));
    }, target - Date.now());
  };
  scheduleNext();
  refresh().catch(e => log(e.message));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    clearTimeout(timer); bonjour.kill(); server.close(); process.exit(0);
  });
}
