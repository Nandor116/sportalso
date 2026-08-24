// Végpont-teszt: generál → szerializál → aláír → ellenőriz → tamper-ellenőrzés
const nacl = require("tweetnacl");

const kp = nacl.sign.keyPair();
const secret = kp.secretKey;
const pub = kp.publicKey;

const payload = JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  events: [{ id: "abc123", title: "Teszt Koncert", startsAt: new Date().toISOString(), ticketUrl: "https://x.y" }]
}, null, 2) + "\n";

const sig = nacl.sign.detached(Buffer.from(payload), secret);
const sigB64 = Buffer.from(sig).toString("base64");

const ok = nacl.sign.detached.verify(Buffer.from(payload), Buffer.from(sigB64, "base64"), pub);
console.log("Érvényes aláírás elfogadva:", ok);

const tampered = payload.replace("Teszt Koncert", "Tamper Koncert");
const bad = nacl.sign.detached.verify(Buffer.from(tampered), Buffer.from(sigB64, "base64"), pub);
console.log("Módosított fájl elutasítva:", !bad);

if (!ok || bad) { console.error("FAIL"); process.exit(1); }
console.log("ROUNDTRIP OK");
