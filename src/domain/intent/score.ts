import { z } from "zod";

/**
 * Contact intent (§7.6): how sure is it that the prospect wanted to get in
 * touch? Every signal has a probability p; they combine by Noisy-OR,
 * `score = 1 − Π(1 − pᵢ)`. A confirmed contact sets the score to 100 %.
 * Signals never expire; the cockpit shows how old the last one is.
 */
export const SIGNAL_IDS = [
  "visit",
  "read",
  "return_visit",
  "forwarded",
  "contact_view",
  "contact_hover",
  "pricing",
  "chat_open",
  "draft_short",
  "draft_long",
  "callback_started",
  "contact_copied",
  "channel_click",
  "booking_open",
  "confirmed",
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

/** Signals whose weight the owner can change; `confirmed` is always 1. */
export type WeightedSignalId = Exclude<SignalId, "confirmed">;

export const DEFAULT_WEIGHTS: Record<WeightedSignalId, number> = {
  visit: 0.05,
  read: 0.1,
  return_visit: 0.15,
  forwarded: 0.15,
  contact_view: 0.1,
  contact_hover: 0.1,
  pricing: 0.15,
  chat_open: 0.2,
  draft_short: 0.4,
  draft_long: 0.6,
  callback_started: 0.45,
  contact_copied: 0.55,
  channel_click: 0.7,
  booking_open: 0.5,
};

/** Labels for the weight editor and the signal list in the cockpit. */
export const SIGNAL_LABELS: Record<SignalId, string> = {
  visit: "Echter Scan oder Klick",
  read: "Mindestens 2 Minuten oder 75 % gelesen",
  return_visit: "An einem anderen Tag wiedergekommen",
  forwarded: "Weitergeleiteten Link geöffnet",
  contact_view: "Kontaktbereich mindestens 5 Sekunden angesehen",
  contact_hover: "Kontakt-Button mindestens 1 Sekunde angesteuert",
  pricing: "Preise interaktiv genutzt",
  chat_open: "Chat geöffnet",
  draft_short: "Im Chat mindestens 3 Zeichen getippt, nicht gesendet",
  draft_long: "Im Chat mindestens 20 Zeichen getippt, nicht gesendet",
  callback_started: "Rückrufformular begonnen",
  contact_copied: "Telefonnummer oder E-Mail-Adresse kopiert",
  channel_click: "WhatsApp, E-Mail, Messenger, SMS oder Anruf geklickt",
  booking_open: "Terminbuchung geöffnet",
  confirmed: "Nachricht gesendet oder Rückruf angefordert",
};

const weight = z.number().min(0).max(0.99);
export const scoreWeightsSchema = z
  .object(
    Object.fromEntries(
      (Object.keys(DEFAULT_WEIGHTS) as WeightedSignalId[]).map((id) => [id, weight.optional()]),
    ) as Record<WeightedSignalId, z.ZodOptional<typeof weight>>,
  )
  .catch({});
export type ScoreWeights = z.infer<typeof scoreWeightsSchema>;

export function resolveWeights(
  overrides: ScoreWeights | undefined,
): Record<WeightedSignalId, number> {
  return {
    ...DEFAULT_WEIGHTS,
    ...Object.fromEntries(
      Object.entries(overrides ?? {}).filter(([, value]) => typeof value === "number"),
    ),
  };
}

export type Device = "mobile" | "tablet" | "desktop" | "unknown";
export type ContactChannelKind = "whatsapp" | "phone" | "email" | "messenger" | "sms";

/** What the database knows about a prospect, real visits only (no bots, no owner). */
export interface IntentFacts {
  visits: {
    id: string;
    startedAt: Date;
    activeSeconds: number;
    maxScroll: number;
    device: Device;
    forwarded: boolean;
  }[];
  events: {
    visitId: string;
    type: string;
    occurredAt: Date;
    payload: Record<string, unknown>;
  }[];
  drafts: { visitId: string; maxLength: number; updatedAt: Date }[];
  messages: { visitId: string | null; createdAt: Date }[];
  callbacks: { visitId: string | null; createdAt: Date }[];
}

export interface Signal {
  id: SignalId;
  p: number;
  /** Latest occurrence. */
  at: Date;
  device: Device;
  /** Details for the explanation. */
  channel?: ContactChannelKind | "chat" | "callback";
  minutes?: number;
  length?: number;
  copied?: "phone" | "email";
}

export const READ_SECONDS = 120;
export const READ_SCROLL = 75;
export const CONTACT_VIEW_SECONDS = 5;
export const SHORT_DRAFT = 3;
export const LONG_DRAFT = 20;

const LINK_CHANNELS = new Set(["whatsapp", "phone", "email", "messenger", "sms"]);

/** The distinct signals in the facts, each with its latest occurrence. */
export function detectSignals(
  facts: IntentFacts,
  weights: Record<WeightedSignalId, number>,
  dayOf: (date: Date) => string,
): Signal[] {
  const deviceOf = new Map(facts.visits.map((visit) => [visit.id, visit.device]));
  const device = (visitId: string | null) => (visitId && deviceOf.get(visitId)) || "unknown";
  const found = new Map<SignalId, Signal>();
  const add = (signal: Omit<Signal, "p">) => {
    const p = signal.id === "confirmed" ? 1 : weights[signal.id];
    const current = found.get(signal.id);
    if (!current || current.at < signal.at) found.set(signal.id, { ...signal, p });
  };

  const latest = facts.visits.reduce<IntentFacts["visits"][number] | null>(
    (best, visit) => (!best || visit.startedAt > best.startedAt ? visit : best),
    null,
  );
  if (latest) add({ id: "visit", at: latest.startedAt, device: latest.device });

  const totalSeconds = facts.visits.reduce((sum, visit) => sum + visit.activeSeconds, 0);
  const readVisits = facts.visits.filter(
    (visit) => visit.activeSeconds >= READ_SECONDS || visit.maxScroll >= READ_SCROLL,
  );
  for (const visit of readVisits) {
    add({
      id: "read",
      at: visit.startedAt,
      device: visit.device,
      minutes: Math.max(1, Math.round(totalSeconds / 60)),
    });
  }

  const days = new Set(facts.visits.map((visit) => dayOf(visit.startedAt)));
  if (days.size >= 2 && latest)
    add({ id: "return_visit", at: latest.startedAt, device: latest.device });

  for (const visit of facts.visits.filter((v) => v.forwarded)) {
    add({ id: "forwarded", at: visit.startedAt, device: visit.device });
  }

  for (const event of facts.events) {
    const base = { at: event.occurredAt, device: device(event.visitId) };
    switch (event.type) {
      case "section_dwell":
        if (
          event.payload.blockType === "contact" &&
          Number(event.payload.seconds) >= CONTACT_VIEW_SECONDS
        ) {
          add({ id: "contact_view", ...base });
        }
        break;
      case "cta_hover":
        add({ id: "contact_hover", ...base });
        break;
      case "pricing_change":
        add({ id: "pricing", ...base });
        break;
      case "chat_open":
        add({ id: "chat_open", ...base });
        break;
      case "callback_started":
        add({ id: "callback_started", ...base });
        break;
      case "copy_contact":
        add({
          id: "contact_copied",
          ...base,
          copied: event.payload.channel === "email" ? "email" : "phone",
        });
        break;
      case "contact_click": {
        const channel = String(event.payload.channel);
        if (channel === "booking") add({ id: "booking_open", ...base });
        else if (LINK_CHANNELS.has(channel)) {
          add({ id: "channel_click", ...base, channel: channel as ContactChannelKind });
        }
        break;
      }
    }
  }

  for (const draft of facts.drafts) {
    const base = { at: draft.updatedAt, device: device(draft.visitId), length: draft.maxLength };
    if (draft.maxLength >= LONG_DRAFT) add({ id: "draft_long", ...base });
    if (draft.maxLength >= SHORT_DRAFT) add({ id: "draft_short", ...base });
  }

  for (const message of facts.messages) {
    add({
      id: "confirmed",
      at: message.createdAt,
      device: device(message.visitId),
      channel: "chat",
    });
  }
  for (const callback of facts.callbacks) {
    add({
      id: "confirmed",
      at: callback.createdAt,
      device: device(callback.visitId),
      channel: "callback",
    });
  }

  return [...found.values()].sort((a, b) => b.p - a.p || b.at.getTime() - a.at.getTime());
}

/** Noisy-OR in percent, rounded down so 99.6 % never reads as confirmed. */
export function combine(signals: Pick<Signal, "p">[]): number {
  if (signals.some((signal) => signal.p >= 1)) return 100;
  const miss = signals.reduce((product, signal) => product * (1 - signal.p), 1);
  return Math.min(99, Math.floor((1 - miss) * 100 + 1e-9));
}

export const INTENT_LEVELS = [
  "curious",
  "interested",
  "likely",
  "very_likely",
  "confirmed",
] as const;
export type IntentLevel = (typeof INTENT_LEVELS)[number];

export const LEVEL_LABELS: Record<IntentLevel, string> = {
  curious: "Neugierig",
  interested: "Interessiert",
  likely: "Wahrscheinlicher Kontaktversuch",
  very_likely: "Sehr wahrscheinlicher Kontaktversuch",
  confirmed: "Kontakt bestätigt",
};

export function levelFor(score: number): IntentLevel {
  if (score >= 100) return "confirmed";
  if (score >= 80) return "very_likely";
  if (score >= 50) return "likely";
  if (score >= 25) return "interested";
  return "curious";
}
