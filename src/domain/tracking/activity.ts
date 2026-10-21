/**
 * The live feed on „Heute“ (§7.8): only that a prospect is in their exposé
 * right now, never which section they read or what they click (ADR-0064).
 * Timeline and analytics keep the details after the fact.
 */
export const PRESENT_PHRASE = "ist gerade im Exposé";

export function activityPhrase(event: { type: string }): string | null {
  return event.type === "heartbeat" || event.type === "page_view" ? PRESENT_PHRASE : null;
}
