# Sportalsó — publikus adatformátum és aláírási szabályok

## Fájlok a statikus tárhelyen

- `events.json` — maga az eseménylista (pontosan ezek a bájtok lesznek aláírva)
- `events.sig` — base64 kódolású **Ed25519 detached** aláírás a `events.json` bájtjaira (tweetnacl `nacl.sign.detached`)

Az app mindkét fájlt letölti, és a beépített nyilvános kulccsal ellenőrzi. Az aláírás a fájl **pontos bájtjaira** szól: nem lehet újraformázni/újrasorrendezni a JSON-t publikálás után!

## events.json séma

```json
{
  "version": 3,
  "generatedAt": "2026-08-24T10:00:00.000Z",
  "events": [
    {
      "id": "k7x2pq",
      "title": "Példa Koncert",
      "startsAt": "2026-09-12T18:00:00.000Z",
      "ticketUrl": "https://example.com/jegy",
      "note": "Ajtó 19:00"
    }
  ]
}
```

| Mező | Kötelező | Leírás |
|---|---|---|
| `version` | igen | monoton nő minden publikálásnál (ütközésvédelem alapja) |
| `generatedAt` | igen | UTC ISO időpont (informatív) |
| `events[].id` | igen | rövid random azonosító (6 karakter) |
| `events[].title` | igen | koncert címe |
| `events[].startsAt` | igen | UTC ISO időpont (`toISOString()`) |
| `events[].ticketUrl` | nem | elővételi link |
| `events[].note` | nem | szabad megjegyzés |

A helyszín és város fix (az appba van beégetve), ezért nem része az eseménynek.

## Szabályok

1. Publikálás = `events.json` + `events.sig` együtt frissül.
2. `version` csak nőhet; ha az app régebbi verziót lát, azt eldobja (stale védelem).
3. Kulcsrotáció: új kulcspár → új nyilvános kulcs app-frissítésben.
4. A titkos kulcs HEX formátumú 64 bájt (`nacl.sign.keyPair().secretKey`), sosem kerül repóba vagy az appba.
