import { randomCode, UNAMBIGUOUS_ALPHABET } from "../codes";

/**
 * Short links and QR tokens (§6.2). QR codes carry a long token nobody types;
 * letters print a short code (or a readable slug) people type in. Both live
 * as a single path segment on the workspace host: `<host>/<code>`.
 */

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 12 base62 characters ≈ 71 bits: not guessable, not enumerable. */
export function generateQrToken(): string {
  return randomCode(12, BASE62);
}

/** 4 characters from the unambiguous alphabet (31^4 ≈ 920k per workspace). */
export function generateShortCode(length = 4): string {
  return randomCode(length, UNAMBIGUOUS_ALPHABET);
}

/** First path segments of a workspace host that are routes, not codes. */
export const RESERVED_CODES = new Set([
  "x",
  "t",
  "assets",
  "impressum",
  "datenschutz",
  "robots.txt",
  "favicon.ico",
  "icon.svg",
  "owner-device",
]);

const QR_TOKEN = /^[0-9A-Za-z]{12,40}$/;
const SHORT_CODE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isQrTokenShape(segment: string): boolean {
  return QR_TOKEN.test(segment);
}

/**
 * What a person typed, reduced to the stored form: case-insensitive,
 * umlauts spelled out, spaces and underscores as hyphens, stray
 * punctuation from copying (trailing dot, slash) removed.
 */
export function normalizeShortCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export type ShortCodeProblem = "invalid" | "reserved";

/** Validates a custom short code chosen in the cockpit (after normalising). */
export function checkShortCode(code: string): ShortCodeProblem | null {
  if (!SHORT_CODE.test(code) || code.length < 3) return "invalid";
  if (RESERVED_CODES.has(code)) return "reserved";
  return null;
}

/** Characters people mix up when typing from paper. */
function canonical(code: string): string {
  return code.replace(/[o]/g, "0").replace(/[il]/g, "1");
}

/** Optimal string alignment distance (Damerau-Levenshtein without repeated edits). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = value;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * „Meinten Sie …?" (§6.2): short codes one typo away (two for long slugs),
 * treating 0/o and 1/l/i as equal. Only short codes are ever suggested,
 * never QR tokens, so suggestions cannot be used to discover links.
 */
export function suggestShortCodes(typed: string, candidates: string[], limit = 3): string[] {
  const input = canonical(normalizeShortCode(typed));
  if (input.length < 3) return [];
  const maxDistance = input.length >= 8 ? 2 : 1;
  return candidates
    .map((code) => ({ code, distance: editDistance(input, canonical(code)) }))
    .filter((entry) => entry.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map((entry) => entry.code);
}
