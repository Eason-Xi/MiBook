import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { normalize } from './usage.mjs';
const codex = process.env.MIBOOK_CODEX ?? 'codex';
export function readRateLimits() {
  return new Promise((accept, reject) => {
    const child = spawn(codex, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill();
      process.removeListener('exit', cleanup);
      error ? reject(error) : accept(result);
    };
    const timer = setTimeout(() => finish(new Error('Codex usage request timed out')), 45_000);
    const cleanup = () => child.kill();
    process.once('exit', cleanup);
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.on('exit', () => finish(new Error('Codex app-server exited before replying')));
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) return finish(new Error('Codex usage read failed; check Codex sign-in'));
      if (message.id === 1) {
        send({ method: 'initialized', params: {} });
        send({ method: 'account/rateLimits/read', id: 2 });
      } else {
        try { finish(null, normalize(message.result)); }
        catch (error) { finish(error); }
      }
    });
    send({ method: 'initialize', id: 1, params: {
      clientInfo: { name: 'mibook_usage_display', title: 'MiBook Usage Display', version: '1.0.0' },
    } });
  });
}
