/**
 * AES-256-GCM for integration secrets stored in the database (§9a). Uses
 * WebCrypto only, so it runs unchanged on Workers and Node.
 * Format: v1.<base64url iv>.<base64url ciphertext+tag>
 */

const VERSION = "v1";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function importSecretKey(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key), (char) => char.charCodeAt(0));
  if (raw.length !== 32) throw new Error("Encryption key must be 32 bytes (base64-encoded)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** `context` is bound as additional data, e.g. "<workspaceId>:<integration kind>". */
export async function encryptSecret(key: CryptoKey, plaintext: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(key: CryptoKey, payload: string, context: string) {
  const [version, iv, data] = payload.split(".");
  if (version !== VERSION || !iv || !data) throw new Error("Unsupported secret format");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(iv), additionalData: new TextEncoder().encode(context) },
    key,
    fromBase64Url(data),
  );
  return new TextDecoder().decode(plaintext);
}

/** SHA-256 hex digest, e.g. for API tokens (only hashes are stored). */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
