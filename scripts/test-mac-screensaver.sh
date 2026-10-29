#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
dist/小米屏保.app/Contents/MacOS/MiBookScreensaver --self-test --test-output build/screensaver/editor-validation
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {prepareOverlay, photos} from './bridge/screensaver-overlay.mjs';
const folder = resolve('build/screensaver/editor-validation');
const id = randomUUID();
const device = await readFile(folder + '/device.png');
assert.equal(device.readUInt32BE(16), 1404);
assert.equal(device.readUInt32BE(20), 1872);
const logical = await readFile(folder + '/landscape.png');
assert.equal(logical.readUInt32BE(16), 1872);
assert.equal(logical.readUInt32BE(20), 1404);
const result = await prepareOverlay(folder + '/device.png', id, folder);
assert.equal(result.requiresReboot, true);
const entries = execFileSync('/usr/bin/unzip', ['-Z1', folder + '/' + id + '.apk'], {encoding: 'utf8'}).trim().split('\n');
for (const photo of photos) {
  const path = entries.find(entry => entry.startsWith('res/drawable-sw748dp-hdpi') && entry.endsWith('/' + photo + '.png'));
  assert.ok(path, 'Missing screen resource ' + photo);
  const actual = execFileSync('/usr/bin/unzip', ['-p', folder + '/' + id + '.apk', path]);
  assert.deepEqual(actual, device, photo + ' must preserve the prepared landscape pixels');
}
console.log('PASS: landscape export, physical upload dimensions and all eight compiled screen resources');
JS
