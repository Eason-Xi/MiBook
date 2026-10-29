#!/usr/bin/env python3
"""Download hash-pinned upstream root tools. Does not access or flash a device."""
import argparse
import hashlib
import os
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = 'https://raw.githubusercontent.com/qwerty12/inkPalm-5-EPD105-root/main/'
FILES = [
    ('dump-kernel-reference.zip', UPSTREAM + 'dump_kernel_to_system_signed.zip',
     '0f56d5c785c738e1f6437dfdbfe7c79ded54089dfc7e6df67fcda53610e7e8a7'),
    ('public-aosp-testkey.pk8', UPSTREAM + 'testkey.pk8',
     '495675d32e89a149d5abe191f4e9c0e218b9068714e9b53a7c91e164a0741a23'),
    ('Magisk-v31.1.apk', 'https://github.com/topjohnwu/Magisk/releases/download/v31.1/Magisk-v31.1.apk',
     '89cefac0a318afa39fb3880c45c87b036c05bc1ebf02a7a715b7f8d7c26ac6e7'),
]

def prepare(folder):
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, url, expected in FILES:
        target = folder / name
        if target.exists():
            data = target.read_bytes()
        else:
            request = urllib.request.Request(url, headers={'User-Agent': 'MiBook-root-setup/1.0'})
            with urllib.request.urlopen(request, timeout=120) as response:
                data = response.read(32 * 1024 * 1024 + 1)
        if len(data) > 32 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Checksum mismatch; stopped without executing: ' + name)
        if not target.exists():
            target.write_bytes(data)
            os.chmod(target, 0o600)
        print('Verified:', name)
    key = folder / 'public-aosp-testkey.pem'
    subprocess.run(['openssl', 'pkcs8', '-inform', 'DER', '-nocrypt', '-in',
                    str(folder / 'public-aosp-testkey.pk8'), '-out', str(key)], check=True)
    os.chmod(key, 0o600)
    print('Prepared public AOSP test key; it is NOT a private project signing credential.')
    print('No device operations performed. Continue with docs/ROOT.md.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=ROOT / '.state/root/local/deps')
    prepare(parser.parse_args().directory)
