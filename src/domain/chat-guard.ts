/**
 * Abuse rules for what visitors send through the exposé's chat (§10 „Chat:
 * Spam-Schutz“). Pure, so the widget, the routes and the tests share them.
 * Rate limits and the proof of work live on the server
 * (src/server/chat/guard.ts); this file only judges the text itself.
 */

/** More links than this in one message reads as spam, not as a question. */
export const MAX_LINKS = 3;
/** Line breaks beyond this only push the conversation out of view. */
export const MAX_LINES = 40;
/** The same text again within this window is a double send or a flood. */
export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/**
 * Invisible characters that change how text looks without being seen:
 * zero-width spaces and joiners, bidi overrides and isolates (the „Trojan
 * Source“ trick that reverses what the owner reads), the BOM and soft
 * hyphens. Zero-width joiners inside emoji sequences (U+200D) stay.
 */
const INVISIBLE = /[\u00AD\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
/** C0 and C1 control characters other than tab and line feed. */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * The text as it is stored and shown: NFC, without invisible and control
 * characters, Windows line ends unified, at most two blank lines in a row.
 */
export function normalizeMessage(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .replace(CONTROL, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/** Web addresses in the text: with scheme, `www.` or a bare domain with a path. */
export function countLinks(text: string): number {
  const matches = text.match(
    /\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\/[^\s]*/gi,
  );
  return matches?.length ?? 0;
}

export type MessageProblem = "empty" | "links" | "lines" | "duplicate";

export interface PreviousMessage {
  body: string;
  createdAt: Date;
}

/** What is wrong with an already normalized message, or null when it may go out. */
export function messageProblem(
  body: string,
  previous: PreviousMessage | null = null,
  now = Date.now(),
): MessageProblem | null {
  if (!body) return "empty";
  if (countLinks(body) > MAX_LINKS) return "links";
  if (body.split("\n").length > MAX_LINES) return "lines";
  if (
    previous &&
    previous.body === body &&
    now - previous.createdAt.getTime() < DUPLICATE_WINDOW_MS
  ) {
    return "duplicate";
  }
  return null;
}

/** The widget's wording for each problem (formal „Sie“, §11). */
export const MESSAGE_PROBLEM_TEXT: Record<MessageProblem, string> = {
  empty: "Bitte eine Nachricht eingeben.",
  links: `Bitte senden Sie höchstens ${MAX_LINKS} Links pro Nachricht.`,
  lines: "Die Nachricht hat zu viele Zeilen. Bitte fassen Sie sie etwas kürzer.",
  duplicate: "Diese Nachricht haben Sie gerade schon gesendet.",
};
