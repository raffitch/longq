import nacl from "tweetnacl";

const toHex = (bytes) => Buffer.from(bytes).toString("hex");

const main = () => {
  const seed = nacl.randomBytes(32);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);

  console.log("PRIVATE_SEED_HEX=", toHex(seed));
  console.log("PUBLIC_KEY_HEX =", toHex(keyPair.publicKey));
  console.log("\nStore PRIVATE_SEED_HEX as a Wrangler secret:");
  console.log("  wrangler secret put PRIVATE_SEED_HEX");
  console.log("Embed PUBLIC_KEY_HEX in the desktop app for verification.");
};

main();
