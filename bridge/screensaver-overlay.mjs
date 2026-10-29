import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const overlayPackage = 'dev.mibook.screensaver.overlay';
export const moduleID = 'mibook_screensaver';
export const photos = ['photo5', 'photo5_charging', 'photo5_land', 'photo6', 'photo6_charging', 'photo6_land', 'photo7', 'photo8'];
const hash = data => createHash('sha256').update(data).digest('hex');

/** Produces a data-only static overlay, delivered by the existing paired Wi-Fi channel. */
export async function prepareOverlay(image, id, outputDir) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid overlay ID');
  const sdk = process.env.MIBOOK_ANDROID_SDK ?? '/opt/homebrew/share/android-commandlinetools';
  const java = process.env.MIBOOK_JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
  const env = {...process.env, JAVA_HOME: java};
  const tools = sdk + '/build-tools/34.0.0';
  await mkdir(outputDir, {recursive: true, mode: 0o700});
  const dir = await mkdtemp(outputDir + '/build-');
  try {
    // This device is 1404 px at 300 dpi: sw748dp. Match that qualifier
    // with the exact hdpi configuration used by the firmware.
    await mkdir(dir + '/res/drawable-sw748dp-hdpi', {recursive: true});
    for (const name of photos) await cp(image, dir + '/res/drawable-sw748dp-hdpi/' + name + '.png');
    const version = Math.floor(Date.now() / 1000);
    await writeFile(dir + '/AndroidManifest.xml', `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${overlayPackage}" android:versionCode="${version}" android:versionName="2.0">
<uses-sdk android:minSdkVersion="27" android:targetSdkVersion="27" />
<overlay android:targetPackage="android" android:priority="999" android:isStatic="true" />
<application android:label="小米自选屏保" android:hasCode="false" android:allowBackup="false" />
</manifest>`);
    // Each resource is a concrete PNG. Android 8 idmap cannot reliably
    // resolve private resource aliases from an overlay into framework-res.
    const options = {env, timeout: 60000, maxBuffer: 1024 * 1024};
    // Keep the PNG color profile: aapt's grayscale crunch changes Android's
    // decoded tones even though a desktop decoder reports identical samples.
    await run(tools + '/aapt', ['package', '--no-crunch', '-f', '-M', dir + '/AndroidManifest.xml', '-S', dir + '/res',
      '-I', sdk + '/platforms/android-34/android.jar', '-F', dir + '/unsigned.apk'], options);
    await run(tools + '/zipalign', ['-f', '4', dir + '/unsigned.apk', dir + '/aligned.apk'], options);
    const apk = outputDir + '/' + id + '.apk';
    await run(tools + '/apksigner', ['sign', '--ks', root + '/.state/display.keystore',
      '--ks-pass', 'pass:mibook-local', '--out', apk, dir + '/aligned.apk'], options);
    await run(tools + '/apksigner', ['verify', apk], options);
    await mkdir(dir + '/module/system/vendor/overlay', {recursive: true});
    await cp(apk, dir + '/module/system/vendor/overlay/MiBookScreensaver.apk');
    await writeFile(dir + '/module/module.prop', `id=${moduleID}\nname=MiBook Screensaver\nversion=2.0\nversionCode=${version}\nauthor=MiBook\ndescription=Custom sleep images for MiDuoKanReaderPro. Disable this module to restore stock images.\n`);
    const zip = outputDir + '/' + id + '.zip';
    await run('/usr/bin/zip', ['-q', '-r', zip, 'module.prop', 'system'], {...options, cwd: dir + '/module'});
    return {method: 'magisk-overlay', moduleSha256: hash(await readFile(zip)), apkSha256: hash(await readFile(apk)), requiresReboot: true};
  } finally { await rm(dir, {recursive: true, force: true}); }
}
