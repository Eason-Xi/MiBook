#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${MIBOOK_JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$PATH"
sdk="${MIBOOK_ANDROID_SDK:-/opt/homebrew/share/android-commandlinetools}"
tools="$sdk/build-tools/34.0.0"
platform="$sdk/platforms/android-34/android.jar"
rm -rf build/classes build/dex
mkdir -p build/classes build/dex dist .state
chmod 700 .state
"$tools/aapt" package -f -M android/AndroidManifest.xml -S android/res -I "$platform" -F build/resources.apk
"$JAVA_HOME/bin/javac" -encoding UTF-8 --release 8 -classpath "$platform" -d build/classes android/src/dev/mibook/codexusage/*.java
"$JAVA_HOME/bin/jar" cf build/classes.jar -C build/classes .
"$tools/d8" --lib "$platform" --min-api 27 --output build/dex build/classes.jar
cp build/resources.apk build/unsigned.apk
(cd build/dex && /usr/bin/zip -q -u ../unsigned.apk classes.dex)
"$tools/zipalign" -f 4 build/unsigned.apk build/aligned.apk
if [ ! -f .state/display.keystore ]; then
    "$JAVA_HOME/bin/keytool" -genkeypair -keystore .state/display.keystore -storepass mibook-local -keypass mibook-local -alias display -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=MiBook Local Display"
    chmod 600 .state/display.keystore
fi
"$tools/apksigner" sign --ks .state/display.keystore --ks-pass pass:mibook-local --out dist/codex-usage.apk build/aligned.apk
"$tools/apksigner" verify dist/codex-usage.apk
echo "Built dist/codex-usage.apk"
