import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { usageServer } from './wifi.mjs';
import { screensaverRoutes } from './screensaver.mjs';

function chunk(name, bytes) {
  const content = Buffer.concat([Buffer.from(name), bytes]);
  let crc = 0xffffffff;
  for (const b of content) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, content, checksum]);
}
function image() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1404); header.writeUInt32BE(1872, 4); header[8] = 8; header[9] = 0;
  const pixels = Buffer.alloc(1405 * 1872, 255);
  for (let row = 0; row < 1872; row++) pixels[row * 1405] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

test('wireless screensaver authenticates, validates images, persists queue and matches acknowledgments', async () => {
  const dir = await mkdtemp(tmpdir() + '/mibook-screensaver-');
  const headers = {Authorization: 'Bearer paired-reader'};
  const server = usageServer({token: 'paired-reader', snapshot: () => null, refresh: async () => {}, screensaver: await screensaverRoutes(dir)});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = async path => (await fetch(base + path, {headers})).json();
  const post = (path, body) => fetch(base + path, {method: 'POST', headers, body});
  try {
    assert.equal((await fetch(base + '/screensaver')).status, 401);
    assert.equal((await fetch(base + '/screensaver/image', {method: 'POST', body: image()})).status, 401);
    assert.equal((await get('/screensaver/status')).online, false);
    assert.equal((await post('/screensaver/image', Buffer.from('not a png'))).status, 400);
    assert.equal((await get('/screensaver')).command, null);
    const png = image();
    const response = await post('/screensaver/image', png);
    assert.equal(response.status, 202);
    const command = await response.json();
    assert.equal(command.sha256, createHash('sha256').update(png).digest('hex'));
    assert.equal((await get('/screensaver')).command.id, command.id);
    assert.deepEqual(Buffer.from(await (await fetch(base + '/screensaver/image/' + command.id, {headers})).arrayBuffer()), png);
    assert.equal((await post('/screensaver/report', JSON.stringify({id: 'old', status: 'applied'}))).status, 409);
    assert.equal((await post('/screensaver/report', JSON.stringify({id: command.id, status: 'applied'}))).status, 200);
    const status = await get('/screensaver/status');
    assert.equal(status.report.id, command.id); assert.equal(status.online, true);
    assert.equal((await post('/screensaver/report', JSON.stringify({id: command.id, status: 'error',
      code: 'unsupported_firmware', message: 'Firmware cannot display custom wallpaper'}))).status, 200);
    const unsupported = await get('/screensaver/status');
    assert.equal(unsupported.report.status, 'error');
    assert.equal(unsupported.report.code, 'unsupported_firmware');
    const handler = await screensaverRoutes(dir);
    let resumed;
    await handler({method: 'GET', url: '/screensaver'}, {writeHead() {}, end(text) { resumed = JSON.parse(text); }});
    assert.equal(resumed.command.id, command.id);
    assert.equal((await post('/screensaver/restore', '{}')).status, 202);
    assert.equal((await get('/screensaver/status')).report, null);
    assert.equal((await get('/screensaver')).command.action, 'restore');
    let denied;
    await handler({method: 'POST', url: '/screensaver/default', socket: {remoteAddress: '192.168.1.2'}},
      {writeHead(status) { denied = status; }, end() {}});
    assert.equal(denied, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, {recursive: true, force: true});
  }
});


test('root protocol delivers data modules, tracks reboot and persists reader/results', async () => {
  const dir = await mkdtemp(tmpdir() + '/mibook-root-protocol-');
  const headers = {Authorization: 'Bearer paired-reader'};
  let failBuild = false;
  const prepareOverlay = async (_image, id, folder) => {
    if (failBuild) throw new Error('Build failed');
    await writeFile(folder + '/' + id + '.zip', 'test-data-only-module');
    return {method: 'magisk-overlay', moduleSha256: 'a'.repeat(64), apkSha256: 'b'.repeat(64), requiresReboot: true};
  };
  const handler = await screensaverRoutes(dir, {prepareOverlay});
  const server = usageServer({token: 'paired-reader', snapshot: () => null, refresh: async () => {}, screensaver: handler});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = async path => (await fetch(base + path, {headers})).json();
  const post = (path, body) => fetch(base + path, {method: 'POST', headers, body});
  try {
    assert.equal((await post('/screensaver/reader', '{}')).status, 400);
    assert.equal((await post('/screensaver/reader', JSON.stringify({protocolVersion: 2, rootAvailable: true}))).status, 200);
    const response = await post('/screensaver/image', image());
    const command = await response.json();
    assert.equal(response.status, 202); assert.equal(command.requiresReboot, true);
    assert.equal(command.moduleSha256, 'a'.repeat(64));
    const route = '/screensaver/module/' + command.id;
    assert.equal((await fetch(base + route)).status, 401);
    assert.equal(await (await fetch(base + route, {headers})).text(), 'test-data-only-module');
    await post('/screensaver/report', JSON.stringify({id: command.id, status: 'pending_reboot'}));
    assert.equal((await get('/screensaver/status')).report.status, 'pending_reboot');
    await post('/screensaver/report', JSON.stringify({id: command.id, status: 'applied', message: 'Pixels verified'}));
    const resumed = await screensaverRoutes(dir, {prepareOverlay});
    let saved;
    await resumed({method: 'GET', url: '/screensaver/status'}, {writeHead() {}, end(value) { saved = JSON.parse(value); }});
    assert.equal(saved.reader.rootAvailable, true); assert.equal(saved.report.status, 'applied');
    failBuild = true;
    assert.equal((await post('/screensaver/image', image())).status, 500);
    assert.equal((await get('/screensaver/status')).command.id, command.id);
    const restore = await (await post('/screensaver/default', '{}')).json();
    assert.equal(restore.requiresReboot, true); assert.equal(restore.method, 'magisk-overlay');
    assert.equal((await fetch(base + '/screensaver/module/' + restore.id, {headers})).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, {recursive: true, force: true});
  }
});
