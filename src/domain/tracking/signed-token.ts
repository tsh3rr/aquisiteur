/**
 * Short, signed tokens for the public tracking flow (§6.2): the resolver
 * hands the exposé a ticket for its visit, the exposé's script gets a
 * token for sending events. HMAC-SHA-256 over "<purpose>.<id>.<expiry>",
 * base64url. Web Crypto only, so it runs on Workers and Node alike.
 */
export type TokenPurpose =
  | "ticket"
  | "visit"
  | "owner"
  | "owner_link"
  /** Access to one chat thread from the exposé (phase 3). */
  | "chat"
  /** Listening on one realtime topic (phase 3). */
  | "live";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`aquisiteur-tracking:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64url(new Uint8Array(signature)).slice(0, 32);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(
  secret: string,
  purpose: TokenPurpose,
  id: string,
  ttlSeconds: number,
  now = Date.now(),
): Promise<string> {
  const expires = Math.floor(now / 1000) + ttlSeconds;
  const body = `${id}.${expires.toString(36)}`;
  return `${body}.${await hmac(secret, `${purpose}.${body}`)}`;
}

/** The id inside a valid, unexpired token of this purpose, else null. */
export async function verifyToken(
  secret: string,
  purpose: TokenPurpose,
  token: string,
  now = Date.now(),
): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expires, signature] = parts as [string, string, string];
  if (!id || !/^[0-9a-z]+$/.test(expires)) return null;
  if (parseInt(expires, 36) * 1000 < now) return null;
  const expected = await hmac(secret, `${purpose}.${id}.${expires}`);
  return timingSafeEqual(signature, expected) ? id : null;
}
