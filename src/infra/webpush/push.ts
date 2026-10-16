import type { PushPort, PushSubscriptionKeys } from "../types";

/**
 * Web Push without a library, on WebCrypto only, so it runs on Workers and
 * Node alike: payload encryption per RFC 8291 (aes128gcm, RFC 8188) and
 * VAPID per RFC 8292.
 */
export interface VapidConfig {
  /** Uncompressed P-256 public key, base64url (65 bytes). */
  publicKey: string;
  /** P-256 private scalar d, base64url (32 bytes). */
  privateKey: string;
  /** mailto: or https: contact for the push service. */
  subject: string;
}

const encoder = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** JWK for a P-256 key from its raw public point (and optionally d). */
function jwk(publicKey: Uint8Array, d?: string): JsonWebKey {
  return {
    kty: "EC",
    crv: "P-256",
    x: b64url(publicKey.slice(1, 33)),
    y: b64url(publicKey.slice(33, 65)),
    ...(d ? { d } : {}),
    ext: true,
  };
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

export interface EncryptOptions {
  /** Test hooks: fixed sender key pair and salt (RFC 8291, appendix A). */
  senderPrivateKey?: string;
  senderPublicKey?: string;
  salt?: Uint8Array<ArrayBuffer>;
}

/** The encrypted request body for one subscription (one aes128gcm record). */
export async function encryptPayload(
  keys: PushSubscriptionKeys,
  plaintext: Uint8Array,
  options: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let senderPrivate: CryptoKey;
  let senderPublic: Uint8Array<ArrayBuffer>;
  if (options.senderPrivateKey && options.senderPublicKey) {
    senderPublic = fromB64url(options.senderPublicKey);
    senderPrivate = await crypto.subtle.importKey(
      "jwk",
      jwk(senderPublic, options.senderPrivateKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    senderPrivate = pair.privateKey;
    senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }

  const receiver = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiver }, senderPrivate, 256),
  );
  const ikm = await hkdf(
    authSecret,
    ecdhSecret,
    concat(encoder.encode("WebPush: info\0"), uaPublic, senderPublic),
    32,
  );
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 marks the last (and only) record.
  const record = concat(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, record),
  );

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, ciphertext);
}

/** `Authorization` header value for the push service at `endpoint`. */
export async function vapidAuthorization(
  config: VapidConfig,
  endpoint: string,
  now = Date.now(),
): Promise<string> {
  const header = b64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: config.subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk(fromB64url(config.publicKey), config.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      encoder.encode(`${header}.${claims}`),
    ),
  );
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${config.publicKey}`;
}

export function webPush(config: VapidConfig): PushPort {
  return {
    publicKey: config.publicKey,
    async send(subscription, payload) {
      const body = await encryptPayload(subscription.keys, encoder.encode(JSON.stringify(payload)));
      const response = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          authorization: await vapidAuthorization(config, subscription.endpoint),
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(24 * 60 * 60),
          urgency: "high",
          // Replaces an undelivered message of the same notification.
          ...(payload.tag
            ? { topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) }
            : {}),
        },
        body,
      });
      if (response.status === 404 || response.status === 410) return { gone: true };
      if (!response.ok) {
        throw new Error(`Push service answered ${response.status}`);
      }
      return { gone: false };
    },
  };
}
