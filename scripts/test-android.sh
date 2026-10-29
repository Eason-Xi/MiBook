#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
java_home="${MIBOOK_JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
mkdir -p build/test-classes
"$java_home/bin/javac" --release 8 -d build/test-classes \
  android/src/dev/mibook/codexusage/IdleSleepTimer.java \
  android/test/dev/mibook/codexusage/IdleSleepTimerTest.java
"$java_home/bin/java" -cp build/test-classes dev.mibook.codexusage.IdleSleepTimerTest
