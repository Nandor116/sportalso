// Kulcspár generátor a Sportalsó eseménylista aláírásához (Ed25519, tweetnacl)
// Használat: node keys/generate-keys.js
// Kimenet: keys/private.key (HEX, TITKOS!) és kiírja a nyilvános kulcsot az appba való bemásoláshoz.

const nacl = require("tweetnacl");
const fs = require("fs");
const path = require("path");

const keypair = nacl.sign.keyPair();
const secretHex = Buffer.from(keypair.secretKey).toString("hex");
const publicHex = Buffer.from(keypair.publicKey).toString("hex");

const outPath = path.join(__dirname, "private.key");
if (fs.existsSync(outPath)) {
  console.error("VAN MÁR private.key! Felülíráshoz töröld kézzel. (Így nem írd véletlenül el az aktív kulcsot.)");
  process.exit(1);
}
fs.writeFileSync(outPath, secretHex + "\n", { mode: 0o600 });

console.log("Titkos kulcs mentve:", outPath);
console.log("(Tárold jelszókezelőben, és csak megbízott adminnak add tovább!)");
console.log("");
console.log("NYILVÁNOS KULCS (ez megy az appba):");
console.log(publicHex);
