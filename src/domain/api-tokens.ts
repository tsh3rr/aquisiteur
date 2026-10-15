/**
 * Workspace API tokens for the exposé CLI and REST API (§9a). The secret is
 * shown once; the database stores only its SHA-256.
 * Format: aq_<32 base62 characters> (~190 bits).
 */
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const API_TOKEN_PATTERN = /^aq_[0-9A-Za-z]{32}$/;

export function generateApiToken(): { token: string; prefix: string } {
  const limit = 256 - (256 % BASE62.length);
  let body = "";
  while (body.length < 32) {
    for (const byte of crypto.getRandomValues(new Uint8Array(48))) {
      if (byte < limit && body.length < 32) body += BASE62[byte % BASE62.length];
    }
  }
  const token = `aq_${body}`;
  return { token, prefix: token.slice(0, 9) };
}

export async function hashApiToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Reads "Authorization: Bearer aq_…"; null when absent or malformed. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  const token = match?.[1];
  return token && API_TOKEN_PATTERN.test(token) ? token : null;
}
