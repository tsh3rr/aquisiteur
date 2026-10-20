import { z } from "zod";

/**
 * Rule engine for owner notifications (§7.7): event → channels → conditions.
 * Pure: the server decides what happened, this module decides who hears it,
 * how, and how updates are grouped.
 */
export const NOTIFICATION_TRIGGERS = [
  "first_visit",
  "return_visit",
  "chat_message",
  "callback",
  "score_threshold",
  "opt_out",
  "daily_digest",
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];
export type NotificationChannel = "push" | "email";

export const TRIGGER_LABELS: Record<NotificationTrigger, string> = {
  first_visit: "Erster echter Scan",
  return_visit: "Wiederholter Besuch",
  chat_message: "Chat-Nachricht",
  callback: "Rückrufwunsch",
  score_threshold: "Score überschreitet Schwelle",
  opt_out: "„Kein Interesse“ geklickt",
  daily_digest: "Tägliche Zusammenfassung",
};

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: "Push",
  email: "E-Mail",
};

export interface NotificationRule {
  id: string;
  trigger: NotificationTrigger;
  /** score_threshold: percent; daily_digest: hour of the day. */
  threshold: number | null;
  channels: NotificationChannel[];
  enabled: boolean;
  quietFrom: string | null;
  quietTo: string | null;
  weekdaysOnly: boolean;
}

/** Inserted for every new workspace (and by migrations 0010 and 0015 for old ones). */
export const DEFAULT_RULES: Omit<NotificationRule, "id">[] = [
  rule("first_visit", null, ["push"]),
  rule("chat_message", null, ["push"]),
  rule("callback", null, ["push"]),
  rule("score_threshold", 50, ["push", "email"]),
  rule("daily_digest", 8, ["email"]),
];

function rule(
  trigger: NotificationTrigger,
  threshold: number | null,
  channels: NotificationChannel[],
): Omit<NotificationRule, "id"> {
  return {
    trigger,
    threshold,
    channels,
    enabled: true,
    quietFrom: null,
    quietTo: null,
    weekdaysOnly: false,
  };
}

const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Bitte als Uhrzeit angeben, z. B. 22:00.");

export const ruleInputSchema = z
  .object({
    trigger: z.enum(NOTIFICATION_TRIGGERS),
    threshold: z.coerce.number().int().optional(),
    channels: z.array(z.enum(["push", "email"])).min(1, "Bitte mindestens einen Kanal wählen."),
    enabled: z.boolean().default(true),
    quietFrom: clock.optional().or(z.literal("").transform(() => undefined)),
    quietTo: clock.optional().or(z.literal("").transform(() => undefined)),
    weekdaysOnly: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.trigger === "score_threshold") {
      if (value.threshold === undefined || value.threshold < 1 || value.threshold > 100) {
        ctx.addIssue({
          code: "custom",
          path: ["threshold"],
          message: "Bitte eine Schwelle zwischen 1 und 100 % angeben.",
        });
      }
    } else if (value.trigger === "daily_digest") {
      if (value.threshold === undefined || value.threshold < 0 || value.threshold > 23) {
        ctx.addIssue({
          code: "custom",
          path: ["threshold"],
          message: "Bitte eine volle Stunde zwischen 0 und 23 angeben.",
        });
      }
    }
    if (Boolean(value.quietFrom) !== Boolean(value.quietTo)) {
      ctx.addIssue({
        code: "custom",
        path: [value.quietFrom ? "quietTo" : "quietFrom"],
        message: "Ruhezeit braucht Beginn und Ende.",
      });
    }
  })
  .transform((value) => ({
    ...value,
    threshold:
      value.trigger === "score_threshold" || value.trigger === "daily_digest"
        ? (value.threshold ?? null)
        : null,
    quietFrom: value.quietFrom ?? null,
    quietTo: value.quietTo ?? null,
  }));
export type RuleInput = z.output<typeof ruleInputSchema>;

/** Hour, minute and weekday (1 = Monday … 7 = Sunday) in the workspace's time zone. */
export function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { hour: Number(get("hour")), minute: Number(get("minute")), weekday };
}

const minutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return h! * 60 + m!;
};

export function inQuietHours(
  rule: Pick<NotificationRule, "quietFrom" | "quietTo">,
  now: Date,
  timeZone: string,
) {
  if (!rule.quietFrom || !rule.quietTo) return false;
  const { hour, minute } = localClock(now, timeZone);
  const current = hour * 60 + minute;
  const from = minutes(rule.quietFrom);
  const to = minutes(rule.quietTo);
  // "22:00"–"07:00" wraps around midnight.
  return from <= to ? current >= from && current < to : current >= from || current < to;
}

export type Suppressed = "quiet_hours" | "weekend" | null;

/**
 * Channels to use now. Outside the rule's conditions the notification is
 * still recorded (cockpit list, digest), just without push or e-mail.
 */
export function deliveryFor(
  rule: Pick<NotificationRule, "channels" | "quietFrom" | "quietTo" | "weekdaysOnly">,
  now: Date,
  timeZone: string,
): { channels: NotificationChannel[]; suppressed: Suppressed } {
  if (rule.weekdaysOnly && localClock(now, timeZone).weekday >= 6) {
    return { channels: [], suppressed: "weekend" };
  }
  if (inQuietHours(rule, now, timeZone)) return { channels: [], suppressed: "quiet_hours" };
  return { channels: [...rule.channels], suppressed: null };
}

export const SUPPRESSED_LABELS: Record<Exclude<Suppressed, null>, string> = {
  quiet_hours: "Ruhezeit",
  weekend: "Wochenende",
};

/** Thresholds the score passed on its way from `before` to `after`. */
export function crossedThresholds(before: number, after: number, thresholds: number[]): number[] {
  return thresholds.filter((threshold) => before < threshold && after >= threshold);
}

/** Updates within this window join the existing notification instead of creating one. */
export const DEBOUNCE_MS = 30 * 60 * 1000;

/** Only new chat messages update the push on the phone; everything else stays quiet. */
export function repushOnUpdate(trigger: NotificationTrigger): boolean {
  return trigger === "chat_message";
}

export function describeRule(
  rule: Pick<
    NotificationRule,
    "trigger" | "threshold" | "channels" | "quietFrom" | "quietTo" | "weekdaysOnly"
  >,
): string {
  const what =
    rule.trigger === "score_threshold"
      ? `Score ab ${rule.threshold ?? 50} %`
      : rule.trigger === "daily_digest"
        ? `Tägliche Zusammenfassung um ${String(rule.threshold ?? 8).padStart(2, "0")}:00`
        : TRIGGER_LABELS[rule.trigger];
  const how = rule.channels.map((channel) => CHANNEL_LABELS[channel]).join(" und ");
  const conditions = [
    rule.quietFrom && rule.quietTo ? `Ruhezeit ${rule.quietFrom}–${rule.quietTo}` : null,
    rule.weekdaysOnly ? "nur werktags" : null,
  ].filter(Boolean);
  return `${what} → ${how}${conditions.length ? ` (${conditions.join(", ")})` : ""}`;
}

/** Clips chat text for a push or an e-mail subject line. */
export function clip(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export interface VisitContext {
  source: "qr" | "typed" | "direct" | "share";
  device: "mobile" | "tablet" | "desktop" | "unknown";
  city: string | null;
}

const SOURCE_PHRASES: Record<VisitContext["source"], string> = {
  qr: "Über den QR-Code im Brief",
  typed: "Über den abgetippten Kurzlink",
  direct: "Direkt aufgerufen",
  share: "Über einen weitergeleiteten Link",
};

const DEVICE_PHRASES: Record<VisitContext["device"], string | null> = {
  mobile: "auf dem Smartphone",
  tablet: "auf dem Tablet",
  desktop: "am Computer",
  unknown: null,
};

export type NotificationCopyInput =
  | { trigger: "first_visit" | "return_visit"; company: string; visit: VisitContext }
  | { trigger: "chat_message"; company: string; message: string }
  | {
      trigger: "callback";
      company: string;
      name: string;
      phone: string;
      preferredTime: string | null;
    }
  | { trigger: "score_threshold"; company: string; headline: string; recommendation: string }
  | { trigger: "opt_out"; company: string };

/** Title and body of a push, an e-mail and the cockpit list (§7.7). */
export function notificationCopy(input: NotificationCopyInput): { title: string; body: string } {
  switch (input.trigger) {
    case "first_visit":
    case "return_visit": {
      const { visit } = input;
      const where = [DEVICE_PHRASES[visit.device], visit.city ? `in ${visit.city}` : null]
        .filter(Boolean)
        .join(" ");
      return {
        title:
          input.trigger === "first_visit"
            ? `${input.company} hat das Exposé geöffnet`
            : `${input.company} liest wieder`,
        body: `${SOURCE_PHRASES[visit.source]}${where ? `, ${where}` : ""}.`,
      };
    }
    case "chat_message":
      return { title: `${input.company} schreibt im Chat`, body: clip(input.message) };
    case "callback":
      return {
        title: `${input.company} bittet um Rückruf`,
        body: [
          input.name,
          input.phone,
          input.preferredTime ? `Wunschzeit: ${input.preferredTime}` : null,
        ]
          .filter(Boolean)
          .join(", "),
      };
    case "score_threshold":
      return { title: `${input.company}: ${input.headline}`, body: input.recommendation };
    case "opt_out":
      return {
        title: `${input.company} möchte keinen Kontakt`,
        body: "Hat im Exposé „Kein Interesse“ bestätigt. Bitte nicht mehr anschreiben.",
      };
  }
}

export type NotificationTarget =
  | { trigger: "chat_message"; threadId: string }
  | {
      trigger: "first_visit" | "return_visit" | "callback" | "score_threshold" | "opt_out";
      prospectId: string;
    }
  | { trigger: "daily_digest" };

/** Section anchors on the prospect page that a notification can open. */
export const PROSPECT_ANCHORS = {
  intent: "kontaktabsicht",
  visits: "besuche",
  contact: "chat",
  privacy: "datenschutz",
} as const;

/**
 * Where tapping a notification lands (§7.7): the spot the event happened,
 * not an overview. A chat message opens the conversation; everything else
 * opens the prospect page at the matching section.
 */
export function notificationUrl(target: NotificationTarget): string {
  switch (target.trigger) {
    case "chat_message":
      return `/chat/${target.threadId}`;
    case "daily_digest":
      return "/";
    case "first_visit":
    case "return_visit":
      return `/kunden/${target.prospectId}#${PROSPECT_ANCHORS.visits}`;
    case "callback":
      return `/kunden/${target.prospectId}#${PROSPECT_ANCHORS.contact}`;
    case "score_threshold":
      return `/kunden/${target.prospectId}#${PROSPECT_ANCHORS.intent}`;
    case "opt_out":
      return `/kunden/${target.prospectId}#${PROSPECT_ANCHORS.privacy}`;
  }
}
