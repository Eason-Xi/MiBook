import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairing } from '../bridge/wifi.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = resolve(root, '.state');
await mkdir(stateDir, {recursive:true, mode:0o700});
const config = await pairing(stateDir);
const bundledAdb = resolve(root, '.tools/platform-tools/adb');
const adb = process.env.MIBOOK_ADB ?? (existsSync(bundledAdb) ? bundledAdb : 'adb');
const connected = execFileSync(adb, ['devices'], {encoding: 'utf8'}).split('\n')
  .map(line => line.trim().split(/\s+/)).filter(parts => parts[1] === 'device').map(parts => parts[0]);
const serial = process.env.MIBOOK_SERIAL ?? (connected.length === 1 ? connected[0] : null);
if (!serial) throw new Error('Connect exactly one authorized reader, or set MIBOOK_SERIAL.');
const remote = '/sdcard/Android/data/dev.mibook.codexusage/files';
const run = args => execFileSync(adb, ['-s', serial, ...args], {stdio: 'inherit'});
run(['shell', 'am', 'force-stop', 'dev.mibook.codexusage']);
run(['shell', 'mkdir', '-p', remote]);
run(['push', stateDir + '/wifi-config.json', remote + '/wifi-config.json']);
run(['shell', 'input', 'keyevent', '224']);
run(['shell', 'am', 'start', '-n', 'dev.mibook.codexusage/.MainActivity']);
console.log('Wi-Fi paired. Mac addresses:', config.hosts.join(', '));
