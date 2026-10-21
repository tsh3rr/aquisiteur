/**
 * Automatic follow-up letters (§7.9): when a first letter has been out for
 * `afterDays` and nobody has opened the exposé, a follow-up draft and a task
 * „Folgebrief drucken“ are prepared. Nothing is sent by itself; with the
 * `manual` provider the owner prints and posts it, as with every letter.
 */

const DAY = 24 * 3600 * 1000;

/**
 * Letters posted longer ago than `afterDays` plus this window are left
 * alone, so turning the rule on (or a job that did not run for a while)
 * never fills the list with follow-ups for months-old letters.
 */
export const FOLLOW_UP_WINDOW_DAYS = 14;

export const FOLLOW_UP_TASK_TITLE = "Folgebrief drucken und versenden";

export interface FollowUpCandidate {
  postedAt: Date;
  /** First real visit of the prospect after the letter was posted. */
  openedAt: Date | null;
  doNotContact: boolean;
  /** A follow-up for the prospect exists already (draft or further, not cancelled). */
  hasFollowUp: boolean;
}

export type FollowUpDecision = "due" | "wait" | "skip";

/**
 * "due": prepare the follow-up now. "wait": not yet, ask again later.
 * "skip": never for this letter (opened, blocked, too old or already followed up).
 */
export function followUpDecision(
  candidate: FollowUpCandidate,
  settings: { enabled: boolean; afterDays: number },
  now: Date,
): FollowUpDecision {
  if (!settings.enabled) return "wait";
  if (candidate.openedAt || candidate.doNotContact || candidate.hasFollowUp) return "skip";
  const dueAt = candidate.postedAt.getTime() + settings.afterDays * DAY;
  if (now.getTime() < dueAt) return "wait";
  if (now.getTime() > dueAt + FOLLOW_UP_WINDOW_DAYS * DAY) return "skip";
  return "due";
}

export function followUpTaskNote(postedOn: string): string {
  return `Kein Besuch im Exposé seit dem ersten Brief vom ${postedOn}. Der Folgebrief liegt als Entwurf unter „Briefe“ bereit, mit eigenem QR-Code.`;
}
