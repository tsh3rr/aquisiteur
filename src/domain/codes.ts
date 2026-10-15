/**
 * Random identifiers people may read, type or see in a URL. The alphabet
 * leaves out characters that are easy to confuse (0/O, 1/l/I) (§6.2).
 */
export const UNAMBIGUOUS_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function randomCode(length: number, alphabet = UNAMBIGUOUS_ALPHABET): string {
  // Rejection sampling keeps the distribution uniform.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < limit && out.length < length) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

/**
 * Public exposé path segment: readable prefix plus 10 random characters
 * (31^10 ≈ 8·10^14), so URLs cannot be guessed or enumerated (§10).
 */
export function exposeSlug(prospectKey: string): string {
  return `${prospectKey.slice(0, 40)}-${randomCode(10)}`;
}

/** Reference code for prefilled messages, e.g. "K7M2" (§7.4). */
export function refCode(length = 4): string {
  return randomCode(length).toUpperCase();
}
