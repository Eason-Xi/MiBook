#!/usr/bin/env python3
"""Check the exact tracked/index contents before a source-only GitHub publication."""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWED_FILES = {'.gitignore', 'README.md', 'THIRD-PARTY.md', 'LICENSE'}
ALLOWED_DIRS = ('android/', 'bridge/', 'macos/', 'scripts/', 'docs/', '.github/')
FORBIDDEN_SUFFIXES = ('.img', '.apk', '.zip', '.pem', '.pk8', '.key', '.keystore', '.jks', '.raw', '.log')
PATTERNS = {
    'private key material': rb'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----',
    'GitHub credential': rb'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})',
    'API credential': rb'\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}',
    'AWS access key': rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'personal absolute path': rb'/Users/' + rb'apple/',
}

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def main():
    paths = [p.decode('utf-8') for p in git('ls-files', '-z').split(b'\0') if p]
    if not paths:
        sys.exit('No tracked files to check; stage the intended source files first.')
    local_secrets = []
    pairing = ROOT / '.state/wifi-config.json'
    if pairing.exists():
        token = json.loads(pairing.read_text()).get('token', '')
        if len(token) >= 32:
            local_secrets.append(token.encode())
    problems = []
    total = 0
    for path in paths:
        if (path not in ALLOWED_FILES and not path.startswith(ALLOWED_DIRS)) or path.endswith(FORBIDDEN_SUFFIXES):
            problems.append((path, 'not in source publication allowlist'))
            continue
        mode = git('ls-files', '--stage', '--', path).split(b' ', 1)[0]
        if mode == b'120000':
            problems.append((path, 'symbolic link not allowed'))
            continue
        content = git('show', ':' + path)
        total += len(content)
        if len(content) > 2 * 1024 * 1024:
            problems.append((path, 'unexpectedly large source file'))
        for label, pattern in PATTERNS.items():
            if re.search(pattern, content):
                problems.append((path, label))
        if any(secret in content for secret in local_secrets):
            problems.append((path, 'contains this installation pairing token'))
    if problems:
        for path, label in problems:
            print('BLOCKED:', path, '-', label)
        sys.exit(1)
    print(f'PASS: {len(paths)} tracked source/document files, {total:,} bytes; publication checks passed')

if __name__ == '__main__':
    main()
