/**
 * Invisible bot check for the exposé's chat and callback form (§10, ADR-0066):
 * a small proof of work in the style of ALTCHA, self-hosted, without
 * cookies, third parties or anything stored about the visitor.
 *
 * The server picks a secret number below POW_MAX and hands out the SHA-256
 * of `<salt><number>` in a signed, short-lived token. The browser tries
 * numbers until the hash matches (on average POW_MAX / 2 hashes, about half a
 * second on a laptop and a few on an old phone, while the visitor is still
 * typing) and sends the number back. A script that wants to open thousands
 * of threads pays that cost every time.
 *
 * Token id: `<subject>~<random>~<challenge hash>`; the salt is the part
 * before the last `~`, so the subject (`v<visit id>` or `x<exposé id>`) is
 * bound into the hash and a solution never works for another visit.
 */

import { sha256Hex } from "@/lib/crypto";

/** Search space. Raising it makes each solution slower for bots and people alike. */
export const POW_MAX = 50_000;
export const POW_TTL_SECONDS = 15 * 60;

export interface PowChallenge {
  /** Signed token (domain/tracking/signed-token, purpose `pow`). */
  pow: string;
  max: number;
}

export interface PowSolution {
  pow: string;
  number: number;
}

/** Salt and expected hash inside a challenge token's id. */
export function powParts(id: string): { subject: string; salt: string; hash: string } | null {
  const parts = id.split("~");
  if (parts.length !== 3) return null;
  const [subject, random, hash] = parts as [string, string, string];
  if (!/^[vx][0-9a-f-]{36}$/.test(subject) || !/^[0-9a-f]{16}$/.test(random)) return null;
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  return { subject, salt: `${subject}~${random}`, hash };
}

/** The id of a new challenge token for `subject`. */
export async function powChallengeId(
  subject: string,
  random = crypto.getRandomValues(new Uint8Array(8)),
  number = randomBelow(POW_MAX),
): Promise<string> {
  const hex = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const salt = `${subject}~${hex}`;
  return `${salt}~${await sha256Hex(`${salt}${number}`)}`;
}

function randomBelow(max: number): number {
  // Rejection sampling: no modulo bias.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  for (;;) {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    if (value! < limit) return value! % max;
  }
}

/** True when `number` solves the challenge in `id` (verified token id). */
export async function powSolves(id: string, number: number): Promise<boolean> {
  const parts = powParts(id);
  if (!parts || !Number.isInteger(number) || number < 0 || number >= POW_MAX) return false;
  return (await sha256Hex(`${parts.salt}${number}`)) === parts.hash;
}

/**
 * Browser side: finds the number, hashing in batches so the page stays
 * responsive (WebCrypto works off the main thread). Null when the token is
 * malformed or the search was aborted.
 */
export async function solvePow(
  challenge: PowChallenge,
  signal?: AbortSignal,
  batch = 500,
): Promise<PowSolution | null> {
  const id = challenge.pow.split(".")[0] ?? "";
  const parts = powParts(id);
  if (!parts) return null;
  const encoder = new TextEncoder();
  const expected = Uint8Array.from(parts.hash.match(/../g)!, (pair) => parseInt(pair, 16));
  const matches = (digest: ArrayBuffer) => {
    const bytes = new Uint8Array(digest);
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== expected[i]) return false;
    return true;
  };
  for (let start = 0; start < challenge.max; start += batch) {
    if (signal?.aborted) return null;
    const end = Math.min(start + batch, challenge.max);
    const digests = await Promise.all(
      Array.from({ length: end - start }, (_, i) =>
        crypto.subtle.digest("SHA-256", encoder.encode(`${parts.salt}${start + i}`)),
      ),
    );
    const found = digests.findIndex(matches);
    if (found !== -1) return { pow: challenge.pow, number: start + found };
  }
  return null;
}
