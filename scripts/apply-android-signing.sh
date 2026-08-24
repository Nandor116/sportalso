#!/bin/zsh
# Prebuild UTÁN kell futtatni: beállítja a release aláírást a generált android projektben.
# A kulcs: ~/sportalso-release.keystore, jelszó: ~/.sportalso-keystore-pass
set -e
cd "$(dirname "$0")/../app/android/app"

perl -0pi -e "s/keyPassword 'android'\n        \}\n    \}/keyPassword 'android'\n        }\n        release {\n            storeFile file(System.getenv(\"HOME\") + \"\/sportalso-release.keystore\")\n            storePassword new File(System.getenv(\"HOME\") + \"\/.sportalso-keystore-pass\").text.trim()\n            keyAlias 'sportalso'\n            keyPassword new File(System.getenv(\"HOME\") + \"\/.sportalso-keystore-pass\").text.trim()\n        }\n    }/" build.gradle

perl -0pi -e 's/\Q            \/\/ Caution! In production, you need to generate your own keystore file.\E\n\s*\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n\s*signingConfig signingConfigs\.debug/            signingConfig signingConfigs.release/s' build.gradle

grep -q "keyAlias 'sportalso'" build.gradle && grep -q "signingConfig signingConfigs.release" build.gradle && echo "Aláírás konfigurálva ✓" || { echo "HIBA: a patch nem illeszkedett"; exit 1; }

# Csak arm64 build (a 4 ABI-s APK ~67 MB volt, így ~20-25 MB lesz)
perl -pi -e 's/^reactNativeArchitectures=.*/reactNativeArchitectures=arm64-v8a/' ../gradle.properties
grep -q "^reactNativeArchitectures=" ../gradle.properties || echo "reactNativeArchitectures=arm64-v8a" >> ../gradle.properties
echo "ABI: $(grep '^reactNativeArchitectures=' ../gradle.properties)"
