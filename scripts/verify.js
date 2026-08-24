// Ellenőrző eszköz: a helyi events.json + events.sig párt validálja
// a keys/private.key-ből származtatott nyilvános kulccsal.
// Használat: npm run verify
const nacl = require("tweetnacl");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const payload = fs.readFileSync(path.join(root, "events.json"));
const sigB64 = fs.readFileSync(path.join(root, "events.sig"), "utf8").trim();
const secretHex = fs.readFileSync(path.join(root, "keys", "private.key"), "utf8").trim();

if (!/^[0-9a-fA-F]{128}$/.test(secretHex)) {
  console.error("A keys/private.key nem 128 hex karakter.");
  process.exit(1);
}

const pub = Buffer.from(
  nacl.sign.keyPair.fromSecretKey(Buffer.from(secretHex, "hex")).publicKey
);

const ok = nacl.sign.detached.verify(payload, Buffer.from(sigB64, "base64"), pub);
if (ok) {
  const data = JSON.parse(payload.toString("utf8"));
  console.log(`OK — aláírás érvényes (version ${data.version}, ${data.events.length} koncert)`);
  console.log(`Nyilvános kulcs (appba): ${pub.toString("hex")}`);
} else {
  console.error("HIBA — az aláírás nem illik az events.json-hez. Újra kell aláírni!");
  process.exit(1);
}
