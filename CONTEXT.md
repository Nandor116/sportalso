# Sportalsó — projekt context (agent-eknek)

Ez a fájl a projekt teljes állapotát összegzi, hogy bármikor, bármilyen agenttel innen folytatható legyen.
Utolsó frissítés: 2026-08-24, verzió 0.0.1.

## Mi ez?

Cross-platform (iOS + Android) koncertlista-app a barátunk koncerthelyének ("Sportalsó", egy fix helyszín).
**Nincs szerver, nincs adatbázis**: a koncertlistát a helyszín gazdája egy böngészős admin oldalon szerkeszti,
az aláírt JSON-t GitHub Pages szolgálja ki, az app letöltéskor ellenőrzi az Ed25519-aláírást a beépített
nyilvános kulccsal. A "rendszergazda" = aki birtokolja a titkos kulcsot.

```
keys/private.key ──► admin/index.html (böngésző) ──► events.json + events.sig
                                                            │ (GitHub Pages: main branch /root)
                                                            ▼
                     app (Expo/RN) ◄── letöltés + aláírás-verifikáció (beépített pubkulcs)
```

## Kulcsadatok

| Mit | Hol |
|---|---|
| Repo | https://github.com/Nandor116/sportalso (publikus, `main`) |
| Élő oldal (adminra irányít) | https://nandor116.github.io/sportalso/ |
| Adat URL | https://nandor116.github.io/sportalso/events.json (+ `.sig`) |
| Nyilvános kulcs (hex) | `9a1daf86b8f836c03a25a9c835f33ec21c8c52e4288d2d2e09c825b305234860` |
| Titkos kulcs | `keys/private.key` — **SOHA nem kerül repóba** (.gitignore kezeli) |
| Git identity (globális) | `Nandor116 <Nandor116@users.noreply.github.com>` |
| gh CLI | authentikálva Nandor116-ként (scope-ok: repo, workflow, read:org) |
| APK aláíró kulcs | `~/sportalso-release.keystore` (alias: `sportalso`), jelszó: `~/.sportalso-keystore-pass` — **MENTENI KELL** (iCloud/Drive), különben később nem telepíthető frissítés a régi APK fölé! |
| Build fájlok | `builds/` (gitignored): `Sportalso-0.0.1.apk`, `Sportalso-0.0.1-unsigned.ipa` |

## Fontos fájlok

- `app/` — Expo SDK 57 / React Native 0.86 / TypeScript app
  - `App.tsx` — fő képernyő (SectionList, hónap-szekciók, bulk "Összes hozzáadása", naptár-szinkron)
  - `lib/data.ts` — letöltés + tweetnacl verifikáció (`fetchAndVerify`, `base64ToBytes`, cache)
  - `lib/calendar.ts` — naptárba mentés, .ics megosztás, `syncAddedFromCalendar` (indításkor naptárból visszaolvassa a "hozzáadva" állapotot: cím + kezdőidő ±5 perc match)
  - `config.ts` — DATA_BASE_URL, PUBLIC_KEY_HEX, VENUE
  - `app.json` — verziók, bundle id `hu.sportalso.app`, ikonok
- `admin/index.html` — böngészős admin: titkos kulccsal feloldható (pubkulcs-egyezéssel), GitHub Contents API-val committol + aláír. Token és kulcs csak runtime-ban élnek, nem tárolódnak. Commitjai: "Koncert lista frissítés (vN)" + "Aláírás (vN)".
- `events.json` + `events.sig` — az élő adatpár a repó gyökerében (Pages serve-li)
- `scripts/test-roundtrip.js` — `npm test`: aláírás roundtrip node-ból
- `scripts/verify.js` — szerveren lévő pair ellenőrzése (`npm run verify`)
- `scripts/apply-android-signing.sh` — prebuild UTÁN kötelező futtatni (lásd release folyamat)
- `keys/generate-keys.js`, `public-format.md` — kulcsgenerálás + adatformátum-dokumentáció
- UI-minta eredetije: `/Users/nandor/Documents/JegyHuScraper/Sources/KoncertekKit/App.swift` (SwiftUI)

## Technikai fogdák (EZeket NE felejtsd el!)

1. **Hermes-ben nincs `atob`** → saját `base64ToBytes` van exportálva `app/lib/data.ts`-ből.
2. **expo-calendar: CSAK az új OO API működik** (SDK 57): `Calendar.requestCalendarPermissions()`,
   `Calendar.getCalendars()`, `calendar.createEvent(...)`, `Calendar.listEvents(calendars, start, end)`.
   A régi függvényes API futásidőben kivételt dob!
3. **expo-file-system: CSAK az új API** (`File`, `Directory`, `Paths.cache/document`):
   `File.write()` szinkron void, `text()` async, `delete()` NEM fogad opciót → mindig `if (file.exists)` guard.
4. **Az App Store-beli Expo Go SDK 54-nél ragadt** → az SDK 57-es app iOS-en csak Simulatorban futtatható:
   Xcode-beta telepítve, iPhone 17 Pro szimulátor. `cd app && npx expo start`, majd `i`.
5. **`npx expo prebuild` ÚJRAGENERÁLJA** az `android/` és `ios/` mappákat → minden prebuild után:
   - Android: futtasd a `scripts/apply-android-signing.sh`-t (visszaírja a release-aláírást)
   - iOS: `pod install` az `ios/` mappában
6. **App ikon Expo Go-ban NEM látszik** (az Expo Go saját ikonja van) — csak standalone buildben.
7. Az admin közvetlenül committol a repóba → lokális push előtt lehet, hogy `git pull --rebase origin main` kell.
8. Ékezetes app-név ("Sportalsó") miatt az Xcode projekt neve `Sportals` (levágta) — workspace: `ios/Sportals.xcworkspace`.

## Build környezet

- Java 17: `export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"`
- Android SDK: `export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`
  (platform-tools, platforms;android-36, build-tools;36.0.0 telepítve)
- Xcode 27 beta (`xcodebuild`), CocoaPods brew-ből

## Release folyamat (új verzió buildelése)

1. `app/app.json`: `version` emelése (pl. 0.0.2), `android.versionCode` +1 (pl. 2), `ios.buildNumber` +1 (pl. "2")
2. Commit + push
3. Natív projektek: `cd app && npx expo prebuild -p android --no-install && npx expo prebuild -p ios --no-install`
4. **APK**:
   ```sh
   scripts/apply-android-signing.sh          # KÖTELEZŐ prebuild után!
   # (a release-aláíráson túl beállítja: reactNativeArchitectures=arm64-v8a → ~20-25 MB APK
   #  0.0.1 még 4 ABI-vel készült, ezért volt 67 MB — 0.0.2-től arm64-only)
   cd app/android
   JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home" \
   ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
     ./gradlew assembleRelease               # ~7 perc első alkalommal több
   cp app/build/outputs/apk/release/app-release.apk ../builds/Sportalso-X.Y.Z.apk
   ```
5. **Unsigned IPA**:
   ```sh
   cd app/ios && pod install && cd ..
   xcodebuild -workspace ios/Sportals.xcworkspace -scheme Sportals -configuration Release \
     -destination 'generic/platform=iOS' -archivePath build/Sportalso.xcarchive archive \
     CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO
   rm -rf /tmp/opencode/ipa && mkdir -p /tmp/opencode/ipa/Payload
   cp -r build/Sportalso.xcarchive/Products/Applications/*.app /tmp/opencode/ipa/Payload/
   cd /tmp/opencode/ipa && zip -qry Sportalso-X.Y.Z-unsigned.ipa Payload \
     && mv Sportalso-X.Y.Z-unsigned.ipa ~/Documents/sportalso/builds/
   ```
6. Ellenőrzés: `apksigner verify --print-certs <apk>` (JAVA_HOME kell neki) → CN=Sportalso-t várunk

Telepítés: APK egyből sideloadolható Androidon; az unsigned IPA-t Feather-rel kell aláírni iOS-en.

## Fejlesztői futtatás

```sh
cd app
npm test          # aláírás roundtrip
npm run verify    # élő szerveren lévő events.json+sig ellenőrzése a beépített kulccsal
npx tsc --noEmit  # típusellenőrzés
npx expo start    # aztán 'i' = iPhone 17 Pro szimulátor (SDK 57-es Expo Go-t maga telepíti)
```

## Aktuális állapot (2026-08-24)

- ✅ Élő rendszer: repo + Pages + admin publikálás működik (v2, 1 koncert, aláírás érvényes)
- ✅ Admin unlock-gate (titkos kulccsal nyitható fel)
- ✅ Koncertek-stílusú UI: hónap-szekciók, "✓ naptárban" jelvény, bulk hozzáadás, naptár-szinkron
- ✅ App ikonok lecserélve (`~/Downloads/sportalso.jpg` alapján)
- ✅ v0.0.1 build elkészült: `builds/Sportalso-0.0.1.apk` (67 MB, 4 ABI) + `Sportalso-0.0.1-unsigned.ipa` (9 MB)
- ⏳ Következő verzió (0.0.2): már csak arm64-v8a APK-t buildelni (a szkript ezt intézi)
- ⏳ A barát teszteli az appot; szimulátoros UI-teszt folyamatban

## Nyitott kérdések / jövőbeli tervek

- **Privát repo kérdés elhalasztva**: ingyenes GitHubon Pages csak publikus repóból megy.
  Opciók: marad publikus (ajánlott — nincs benne semmi érzékeny) / GitHub Pro $4/hó / Cloudflare Pages ingyen privátból.
- **Store-publikálás** (ha egyszer kell): Apple Developer $99/év, Google Play $25 egyszeri.
- Esetleg: kereső/szűrő a listában, push értesítés új koncertnél, több helyszín támogatása.

## TILOS!

- `keys/private.key`, a keystore vagy bármilyen token commitolása
- A titkos kulcs kiírása logba, chatbe, fájlba a repón belül
- Régi expo-calendar/expo-file-system API-k használata (futásidőben elszállnak)

