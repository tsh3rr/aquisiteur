/**
 * Generates a VAPID key pair for Web Push (§7.7). Run once per deployment;
 * the private key is a secret (wrangler secret put VAPID_PRIVATE_KEY).
 */
import { b64url } from "../src/infra/webpush/push";

const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
