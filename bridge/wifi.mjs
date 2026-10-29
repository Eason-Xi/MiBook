import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';

export async function pairing(stateDir) {
  let config;
  try { config = JSON.parse(await readFile(stateDir + '/wifi-config.json', 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!config) config = { token: randomBytes(32).toString('hex'), port: 48763,
    serviceName: 'MiBookCodex-' + randomBytes(4).toString('hex') };
  if (!/^[a-f0-9]{64}$/.test(config.token) || !Number.isInteger(config.port)) throw new Error('Invalid Wi-Fi pairing file');
  config.hosts = Object.values(networkInterfaces()).flat()
    .filter(n => n.family === 'IPv4' && !n.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address))
    .map(n => n.address);
  await writeFile(stateDir + '/wifi-config.json', JSON.stringify(config), {mode: 0o600});
  return config;
}

export function usageServer({ token, snapshot, refresh, screensaver, refreshWaitMs = 10000, log = () => {} }) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const expected = Buffer.from('Bearer ' + token);
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      res.writeHead(401); res.end('{"error":"Pairing required"}'); return;
    }
    if (screensaver && await screensaver(req, res)) return;
    if (!(req.method === 'GET' && req.url === '/usage') && !(req.method === 'POST' && req.url === '/refresh')) {
      res.writeHead(404); res.end('{"error":"Not found"}'); return;
    }
    const peer = req.socket.remoteAddress;
    try {
      if (req.url === '/refresh') {
        // A slow upstream query must not exhaust the reader's network timeout.
        // Refresh continues in the background; retain the snapshot's real dates.
        let timer;
        try {
          await Promise.race([refresh(), new Promise(resolve => { timer = setTimeout(resolve, refreshWaitMs); })]);
        } finally { clearTimeout(timer); }
      }
      const value = snapshot();
      if (!value) throw new Error('Usage not ready');
      res.writeHead(200);
      res.end(JSON.stringify(value));
      log('Wi-Fi usage delivered to ' + peer);
    } catch {
      res.writeHead(503); res.end('{"error":"Codex usage temporarily unavailable"}');
    }
  });
}
