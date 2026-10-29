import test from 'node:test';
import assert from 'node:assert/strict';
import { usageServer } from './wifi.mjs';

test('Wi-Fi requires pairing, serves only usage, and refreshes on demand', async () => {
  let value = null;
  let calls = 0;
  const server = usageServer({token: 'test-token', snapshot: () => value,
    refresh: async () => { calls++; value = {schemaVersion: 1, updatedAt: 123, primary: null}; }});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = {Authorization: 'Bearer test-token'};
  try {
    assert.equal((await fetch(base + '/usage')).status, 401);
    assert.equal((await fetch(base + '/usage', {headers: {Authorization: 'Bearer bad'}})).status, 401);
    assert.equal((await fetch(base + '/usage', {headers})).status, 503);
    assert.equal((await fetch(base + '/files', {headers})).status, 404);
    const refreshed = await fetch(base + '/refresh', {method:'POST', headers});
    assert.equal(refreshed.status, 200);
    assert.equal(calls, 1);
    assert.equal((await refreshed.json()).updatedAt, 123);
    const cached = await fetch(base + '/usage', {headers});
    assert.equal(cached.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await cached.json(), value);
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('slow upstream refresh returns cached usage before the reader times out', async () => {
  let finish;
  let value = {schemaVersion: 1, updatedAt: 123, claudeError: true};
  const pending = new Promise(resolve => { finish = () => { value = {...value, updatedAt: 456}; resolve(); }; });
  const server = usageServer({token: 'test', snapshot: () => value, refresh: () => pending, refreshWaitMs: 20});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = {Authorization: 'Bearer test'};
  try {
    const r = await fetch(base + '/refresh', {method: 'POST', headers, signal: AbortSignal.timeout(2000)});
    assert.equal(r.status, 200);
    assert.equal((await r.json()).updatedAt, 123);
    finish();
    const next = await fetch(base + '/usage', {headers});
    assert.equal((await next.json()).updatedAt, 456);
  } finally { finish(); await new Promise(resolve => server.close(resolve)); }
});
