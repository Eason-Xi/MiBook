#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
app="$root/dist/小米屏保.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" build/swift-cache
CLANG_MODULE_CACHE_PATH="$root/build/swift-cache" /usr/bin/swiftc -parse-as-library -O -module-cache-path "$root/build/swift-cache" macos/MiBookScreensaver.swift -o "$app/Contents/MacOS/MiBookScreensaver"
printf '%s' "$root" > "$app/Contents/Resources/project-root.txt"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>MiBookScreensaver</string>
<key>CFBundleIdentifier</key><string>dev.mibook.screensaver.mac</string>
<key>CFBundleName</key><string>小米屏保</string>
<key>CFBundleDisplayName</key><string>小米屏保</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>2.1.0</string>
<key>CFBundleVersion</key><string>3</string>
<key>LSMinimumSystemVersion</key><string>15.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
/usr/bin/codesign --force --sign - "$app"
echo "Built $app"
