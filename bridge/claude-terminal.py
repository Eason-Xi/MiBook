"""Small PTY adapter for Claude Code's interactive, built-in /usage command."""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

pid, master = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])

fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))


def stop(_signum, _frame):
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    sys.exit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    while True:
        readable, _, _ = select.select([master, 0], [], [])
        if master in readable:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            os.write(1, data)
        if 0 in readable:
            data = os.read(0, 4096)
            if not data:
                break
            os.write(master, data)
finally:
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    os.close(master)
    os.waitpid(pid, 0)
