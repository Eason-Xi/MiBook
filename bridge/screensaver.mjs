import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

const MAX_IMAGE = 12 * 1024 * 1024;
const local = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
async function body(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('内容过大'), {status: 413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function validPNG(data) {
  return data.length >= 33 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && data.toString('ascii', 12, 16) === 'IHDR'
    && data.readUInt32BE(16) === 1404 && data.readUInt32BE(20) === 1872;
}

export async function screensaverRoutes(stateDir, {prepareOverlay} = {}) {
  const dir = stateDir + '/screensaver';
  await mkdir(dir, {recursive: true, mode: 0o700});
  let command = null; let report = null; let lastSeen = 0; let reader = null;
  try { command = JSON.parse(await readFile(dir + '/command.json', 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { reader = JSON.parse(await readFile(dir + '/reader.json', 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { const saved = JSON.parse(await readFile(dir + '/report.json', 'utf8')); if (saved.id === command?.id) report = saved; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const save = async next => {
    await writeFile(dir + '/command.json.tmp', JSON.stringify(next), {mode: 0o600});
    await rename(dir + '/command.json.tmp', dir + '/command.json');
    command = next; report = null;
  };
  let writing = false;
  return async (req, res) => {
    if (!req.url.startsWith('/screensaver')) return false;
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    try {
      if (req.method === 'GET' && req.url === '/screensaver/status') {
        send(200, {command, report, reader, lastSeen, online: Date.now() - lastSeen < 20000});
      } else if (req.method === 'GET' && req.url === '/screensaver') {
        lastSeen = Date.now(); send(200, {command});
      } else if (req.method === 'GET' && command?.action === 'image' && req.url === '/screensaver/image/' + command.id) {
        const data = await readFile(dir + '/' + command.id + '.png');
        res.setHeader('Content-Type', 'image/png'); res.writeHead(200); res.end(data);
      } else if (req.method === 'GET' && command?.action === 'image' && command?.method === 'magisk-overlay' && req.url === '/screensaver/module/' + command.id) {
        const data = await readFile(dir + '/' + command.id + '.zip');
        res.setHeader('Content-Type', 'application/zip'); res.writeHead(200);
        res.end(data);
      } else if (req.method === 'POST' && req.url === '/screensaver/reader') {
        const value = JSON.parse((await body(req, 2048)).toString());
        if (value.protocolVersion !== 2 || typeof value.rootAvailable !== 'boolean') { send(400, {error: 'Invalid reader'}); return true; }
        reader = {protocolVersion: 2, rootAvailable: value.rootAvailable, at: Date.now()};
        lastSeen = Date.now();
        await writeFile(dir + '/reader.json.tmp', JSON.stringify(reader), {mode: 0o600});
        await rename(dir + '/reader.json.tmp', dir + '/reader.json');
        send(200, {ok: true});
      } else if (req.method === 'POST' && req.url === '/screensaver/report') {
        const next = JSON.parse((await body(req, 4096)).toString());
        if (!command || next.id !== command.id || !['applied', 'error', 'pending_reboot'].includes(next.status)) {
          send(409, {error: 'Unknown command'});
        } else {
          report = {id: next.id, status: next.status, code: next.code === 'unsupported_firmware' ? next.code : null,
            message: String(next.message ?? '').slice(0, 300), at: Date.now()};
          await writeFile(dir + '/report.json.tmp', JSON.stringify(report), {mode: 0o600});
          await rename(dir + '/report.json.tmp', dir + '/report.json');
          lastSeen = Date.now(); send(200, {ok: true});
        }
      } else if (req.method === 'POST' && ['/screensaver/image', '/screensaver/default', '/screensaver/restore'].includes(req.url)) {
        if (!local(req.socket.remoteAddress)) { send(403, {error: '只能从这台 Mac 更换屏保'}); return true; }
        if (writing) { send(409, {error: '请等待上一次上传完成'}); return true; }
        writing = true;
        try {
          const id = randomUUID();
          const action = req.url.split('/').pop();
          const next = {id, action, createdAt: Date.now()};
          if (action === 'image') {
            const data = await body(req, MAX_IMAGE);
            if (!validPNG(data)) { send(400, {error: '请上传 1404 × 1872 的 PNG 图片'}); return true; }
            next.sha256 = createHash('sha256').update(data).digest('hex');
            await writeFile(dir + '/' + id + '.png', data, {mode: 0o600});
            if (prepareOverlay) Object.assign(next, await prepareOverlay(dir + '/' + id + '.png', id, dir));
          } else await body(req, 1024);
          if (prepareOverlay) { next.method = 'magisk-overlay'; next.requiresReboot = true; }
          await save(next); send(202, next);
        } finally { writing = false; }
      } else send(404, {error: 'Not found'});
    } catch (e) { send(e.status ?? 500, {error: e.status ? e.message : '屏保服务暂不可用'}); }
    return true;
  };
}
