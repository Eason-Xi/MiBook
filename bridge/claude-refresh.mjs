import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readClaude, saveClaude } from './claude.mjs';
import { parseUsageScreen } from './claude-usage-screen.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runFile = promisify(execFile);

// Ask Claude Code itself to refresh /usage in an isolated terminal. This is a
// built-in account query: no user prompt, inference, or OAuth-token extraction.
// Parse its quota pane; a fresh session statusLine has no rate_limits yet.
export async function refreshClaude(stateDir, {claude = process.env.MIBOOK_CLAUDE || resolve(homedir(), '.local/bin/claude')} = {}) {
  // auth status exits nonzero when signed out; its JSON still explains why.
  let authOutput;
  try {
    ({stdout: authOutput} = await runFile(claude, ['auth', 'status'], {timeout: 10000, maxBuffer: 65536}));
  } catch (error) {
    if (!error.stdout) throw new Error('Claude Code login check failed');
    authOutput = error.stdout;
  }
  let auth;
  try { auth = JSON.parse(authOutput); }
  catch { throw new Error('Claude Code login status unavailable'); }
  if (auth.loggedIn !== true) throw new Error('Claude Code is signed out; run claude /login on Mac');
  const settings = JSON.stringify({statusLine: {type: 'command', command: 'true'}});
  const child = spawn(process.env.MIBOOK_PYTHON || '/usr/bin/python3', [resolve(root, 'bridge/claude-terminal.py'), claude,
    '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--settings', settings], {
    cwd: root, detached: true, stdio: ['pipe', 'pipe', 'ignore'],
    env: {...process.env, TZ: 'Asia/Taipei', TERM: 'xterm-256color', COLUMNS: '120', LINES: '40'},
  });
  let timer, usageTimer, done = false, sent = false;
  let screen = '';
  try {
    const result = await new Promise((accept, reject) => {
      const finish = (error, value) => {
        if (done) return; done = true;
        clearTimeout(timer); clearTimeout(usageTimer);
        error ? reject(error) : accept(value);
      };
      child.on('error', () => finish(new Error('Claude Code could not start')));
      child.on('exit', () => finish(new Error('Claude Code exited before returning usage')));
      child.stdin.on('error', () => {});
      child.stdout.on('data', data => {
        screen = (screen + data.toString()).slice(-24000);
        const usage = sent ? parseUsageScreen(screen) : null;
        if (usage) { finish(null, usage); return; }
        const plain = screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
        // Never answer trust/login prompts automatically and never send prose.
        if (!sent && /Claude\s*Code/.test(plain) && plain.includes('❯') && !/Quick\s*safety\s*check/.test(plain)) {
          sent = true;
          usageTimer = setTimeout(() => {
            if (done) return;
            child.stdin.write('/usage\r');
          }, 1000);
        }
      });
      timer = setTimeout(() => finish(new Error('Claude /usage did not return quota data before timeout')), 40000);
    });
    // Whitelist again rather than storing terminal content or session details.
    await saveClaude(result, stateDir);
    return await readClaude(stateDir);
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
    }
  }
}
