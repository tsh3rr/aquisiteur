/**
 * Prints fresh secrets for a deployment, ready to paste into the server's
 * `.env` (docs/DEPLOY.md). Nothing is stored; run it once and keep the
 * output in a password manager.
 */
import { b64url } from "../src/infra/webpush/push";

const random = (bytes: number) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;

const values = {
  BETTER_AUTH_SECRET: random(48),
  INTEGRATIONS_ENCRYPTION_KEY: random(32),
  CRON_SECRET: random(32),
  ORIGIN_SECRET: random(32),
  VAPID_PUBLIC_KEY: b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
  VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d,
};

for (const [name, value] of Object.entries(values)) console.log(`${name}=${value}`);
console.log("\nVAPID_PUBLIC_KEY is a plain variable; all others are secrets.");
