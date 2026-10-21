import { solvePow, type PowChallenge, type PowSolution } from "@/domain/proof-of-work";

/**
 * Fetches a proof-of-work challenge for the chat (visit token) or the
 * callback form (exposé slug) and solves it in the background (ADR-0066).
 * Null when the server refuses (e.g. the chat is blocked) or is unreachable;
 * the send then fails with a clear message instead of hanging.
 */
export async function solveChallenge(
  subject: { token: string } | { slug: string },
): Promise<PowSolution | null> {
  const response = await fetch("/t/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subject),
  }).catch(() => null);
  if (!response?.ok) return null;
  const challenge = (await response.json().catch(() => null)) as PowChallenge | null;
  return challenge ? solvePow(challenge) : null;
}
