import type { NudgeSettings } from "./workspace-settings";

/**
 * Behaviour-based nudges in the exposé (§7.4). Pure decision logic; the
 * exposé feeds it what the tracking script observed. At most one nudge per
 * page view, never while the chat is open.
 */
export const NUDGE_IDS = ["read_invite", "pricing", "returning", "exit_intent"] as const;
export type NudgeId = (typeof NUDGE_IDS)[number];

export interface NudgeState {
  /** Share of the exposé's sections seen, 0–1. */
  readRatio: number;
  /** Visible time on the page, from the heartbeats. */
  activeSeconds: number;
  /** The visitor changed an option in a pricing block. */
  pricingTouched: boolean;
  /** An earlier real visit of this prospect exists. */
  returning: boolean;
  /** Mouse left towards the tab bar (desktop) or a fast scroll up (mobile). */
  exitIntent: boolean;
  chatOpen: boolean;
  /** A nudge was already shown on this page view. */
  shown: boolean;
}

export const READ_INVITE = { ratio: 0.6, seconds: 90 } as const;
/** A returning visitor gets a moment to arrive before being greeted. */
export const RETURNING_DELAY_SECONDS = 15;

export function pickNudge(state: NudgeState, settings: NudgeSettings): NudgeId | null {
  if (!settings.enabled || state.shown || state.chatOpen) return null;
  if (settings.pricing && state.pricingTouched) return "pricing";
  if (
    settings.readInvite &&
    state.readRatio >= READ_INVITE.ratio &&
    state.activeSeconds >= READ_INVITE.seconds
  ) {
    return "read_invite";
  }
  if (settings.exitIntent && state.exitIntent) return "exit_intent";
  if (settings.returning && state.returning && state.activeSeconds >= RETURNING_DELAY_SECONDS) {
    return "returning";
  }
  return null;
}

export interface NudgeCopy {
  text: string;
  action: string;
}

export function nudgeCopy(
  id: NudgeId,
  options: { responseTime: string; chat: boolean },
): NudgeCopy {
  const action = (chatLabel: string) => (options.chat ? chatLabel : "Kontakt aufnehmen");
  switch (id) {
    case "read_invite":
      return { text: `Fragen dazu? ${options.responseTime}`, action: action("Frage stellen") };
    case "pricing":
      return {
        text: "Soll ich Ihnen ein konkretes Angebot für diese Auswahl schicken?",
        action: action("Angebot anfragen"),
      };
    case "returning":
      return {
        text: "Schön, dass Sie wieder da sind. Kann ich Ihnen etwas erklären?",
        action: action("Chat öffnen"),
      };
    case "exit_intent":
      return {
        text: "Bevor Sie gehen: Haben Sie noch eine Frage? Ich helfe gern.",
        action: action("Kurz fragen"),
      };
  }
}

/** The mobile counterpart of exit intent: a quick flick back up the page. */
export function isFastScrollUp(deltaY: number, ms: number): boolean {
  if (ms <= 0) return false;
  return deltaY <= -400 && deltaY / ms <= -2;
}

/** Sticky contact bar on phones once the first third is read. */
export function showStickyBar(scrollRatio: number, settings: NudgeSettings): boolean {
  return settings.stickyBar && scrollRatio >= 1 / 3;
}

/** Prefilled chat text for the pricing nudge: the options the visitor picked. */
export function offerRequestText(options: string[]): string {
  if (options.length === 0) return "Bitte schicken Sie mir ein konkretes Angebot.";
  return `Bitte schicken Sie mir ein konkretes Angebot für: ${options.join(", ")}.`;
}
