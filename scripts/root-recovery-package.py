#!/usr/bin/env python3
"""Build an auditable signed recovery package. Never contacts/flashes a device."""
import argparse
import hashlib
import struct
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.state/root/local'
REF = BASE / 'deps/dump-kernel-reference.zip'
REFERENCE_HASH = '0f56d5c785c738e1f6437dfdbfe7c79ded54089dfc7e6df67fcda53610e7e8a7'
CERT = BASE / 'device-ota.pem'
KEY = BASE / 'deps/public-aosp-testkey.pem'

def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)

def build(mode, output, boot, reference=REF, cert=CERT, key=KEY):
    reference, cert, key = Path(reference), Path(cert), Path(key)
    if hashlib.sha256(reference.read_bytes()).hexdigest() != REFERENCE_HASH:
        raise ValueError('Reference archive changed')
    with ZipFile(reference) as z:
        updater = z.read('META-INF/com/google/android/update-binary')
    script = '''ui_print("MiBook Pro: verifying device and firmware");
assert(getprop("ro.product.device") == "virgo-perf1");
assert(mount("ext4", "EMMC", "/dev/block/by-name/system", "/system") != "");
assert(file_getprop("/system/build.prop", "ro.product.model") == "MiDuoKanReaderPro");
assert(file_getprop("/system/build.prop", "ro.build.version.incremental") == "20220615-182206");
'''
    if mode == 'backup':
        script += '''ui_print("Saving original boot and recovery; no partition is flashed");
assert(run_program("/system/bin/toybox", "mkdir", "-p", "/system/mibook-root-backups") == "0");
assert(run_program("/system/bin/toybox", "dd", "if=/dev/block/by-name/boot", "of=/system/mibook-root-backups/boot.original.img", "bs=1048576") == "0");
assert(run_program("/system/bin/toybox", "dd", "if=/dev/block/by-name/recovery", "of=/system/mibook-root-backups/recovery.original.img", "bs=1048576") == "0");
assert(run_program("/system/bin/toybox", "sync") == "0");
'''
    else:
        image = Path(boot).read_bytes()
        if image[:8] != b'ANDROID!' or len(image) != 32 * 1024 * 1024:
            raise ValueError('Expected a 32 MiB Android boot image for the documented device')
        script += '''ui_print("Writing reviewed boot image to boot partition only");
assert(package_extract_file("boot.img", "/dev/block/by-name/boot"));
assert(run_program("/system/bin/toybox", "sync") == "0");
'''
    script += 'unmount("/system");\nui_print("MiBook package completed");\n'
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        tmp = Path(tmp)
        unsigned = tmp / 'unsigned.zip'
        with ZipFile(unsigned, 'w', compression=ZIP_DEFLATED) as z:
            z.writestr('META-INF/com/google/android/update-binary', updater)
            z.writestr('META-INF/com/google/android/updater-script', script)
            z.writestr('META-INF/com/android/otacert', cert.read_bytes())
            if mode == 'flash': z.writestr('boot.img', image)
        raw = unsigned.read_bytes()
        assert raw[-22:-18] == b'PK\x05\x06' and raw[-2:] == b'\0\0'
        data = tmp / 'signed-data'; data.write_bytes(raw[:-2])
        sig = tmp / 'signature.der'
        run('openssl', 'cms', '-sign', '-binary', '-noattr', '-md', 'sha1',
            '-in', str(data), '-signer', str(cert), '-inkey', str(key), '-outform', 'DER', '-out', str(sig))
        run('openssl', 'cms', '-verify', '-inform', 'DER', '-binary', '-in', str(sig),
            '-content', str(data), '-noverify', '-out', '/dev/null')
        signature = sig.read_bytes()
        prefix = b'signed by MiBook\0'
        comment_size = len(prefix) + len(signature) + 6
        assert comment_size < 65536
        comment = prefix + signature + struct.pack('<HHH', len(signature) + 6, 0xffff, comment_size)
        assert b'PK\x05\x06' not in comment, 'Ambiguous ZIP footer'
        output.write_bytes(raw[:-2] + struct.pack('<H', comment_size) + comment)
    output.with_suffix('.updater-script.txt').write_text(script)
    print(output)
    print('SHA-256:', hashlib.sha256(output.read_bytes()).hexdigest())
    print(script)

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['backup', 'flash'])
    p.add_argument('output')
    p.add_argument('--boot', help='Required only for a reviewed flash/rollback package')
    p.add_argument('--reference', type=Path, default=REF, help='Pinned upstream update-binary archive')
    p.add_argument('--cert', type=Path, default=CERT, help='OTA certificate extracted from your own device')
    p.add_argument('--key', type=Path, default=KEY, help='Downloaded public AOSP test key in PEM format')
    a = p.parse_args()
    if a.mode == 'flash' and not a.boot: p.error('--boot is required for flash')
    build(a.mode, a.output, a.boot, a.reference, a.cert, a.key)
