#!/bin/bash
set -euo pipefail
label=dev.mibook.codexusage.sync
/bin/launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$label.plist"
echo "Mac automatic sync removed. Reader app and last snapshot are retained."
