import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const label = 'dev.mibook.codexusage.sync';
const dir = resolve(homedir(), 'Library/LaunchAgents');
const plist = resolve(dir, label + '.plist');
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tag = s => `<string>${escape(s)}</string>`;
await mkdir(dir, {recursive: true});
await mkdir(resolve(root, '.state'), {recursive: true, mode: 0o700});
await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${tag(label)}
<key>ProgramArguments</key><array>${tag(process.execPath)}${tag(resolve(root, 'bridge/sync.mjs'))}</array>
<key>WorkingDirectory</key>${tag(root)}
<key>EnvironmentVariables</key><dict><key>PATH</key>${tag(dirname(process.execPath) + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')}
${['MIBOOK_CODEX', 'MIBOOK_CLAUDE', 'MIBOOK_PYTHON', 'MIBOOK_JAVA_HOME', 'MIBOOK_ANDROID_SDK'].filter(key => process.env[key]).map(key => `<key>${key}</key>${tag(process.env[key])}`).join('\n')}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key>${tag(resolve(root, '.state/sync.log'))}
<key>StandardErrorPath</key>${tag(resolve(root, '.state/sync-error.log'))}
</dict></plist>`, {mode: 0o600});
const domain = `gui/${process.getuid()}`;
execFileSync('/usr/bin/plutil', ['-lint', plist], {stdio:'inherit'});
let loaded = false;
try { execFileSync('/bin/launchctl', ['print', domain + '/' + label], {stdio:'ignore'}); loaded = true; } catch {}
if (loaded) execFileSync('/bin/launchctl', ['kickstart', '-k', domain + '/' + label], {stdio:'inherit'});
else execFileSync('/bin/launchctl', ['bootstrap', domain, plist], {stdio:'inherit'});
console.log('Installed Mac login sync service:', label);
