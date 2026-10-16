import { z } from "zod";

/**
 * Live chat (§7.5): request shapes shared by the exposé widget, the public
 * routes and the cockpit, plus the pure rules for presence and the offline
 * notice.
 */
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_DRAFT_LENGTH = 5000;
/** Without an answer for this long, the visitor gets the automatic notice. */
export const OFFLINE_AFTER_MS = 2 * 60 * 1000;
/** A cockpit tab reports in every minute; three missed beats mean offline. */
export const PRESENCE_TTL_MS = 3 * 60 * 1000;
export const PRESENCE_BEAT_MS = 60 * 1000;

const visitToken = z.string().min(20).max(200);
const chatToken = z.string().min(20).max(200);
const body = z
  .string()
  .trim()
  .min(1, "Bitte eine Nachricht eingeben.")
  .max(MAX_MESSAGE_LENGTH, `Höchstens ${MAX_MESSAGE_LENGTH} Zeichen.`);

export const visitorMessageSchema = z.object({
  token: visitToken,
  /** Present once the thread exists. */
  chat: chatToken.optional(),
  body,
});

export const visitorTypingSchema = z.object({
  token: visitToken,
  chat: chatToken.optional(),
  length: z.number().int().min(0).max(MAX_DRAFT_LENGTH),
  /** Only sent when the workspace stores draft content and the widget says so. */
  content: z.string().max(MAX_DRAFT_LENGTH).optional(),
});

export const chatReadSchema = z.object({
  chat: chatToken,
  /** Messages after this id only (polling fallback and reconnects). */
  after: z.uuid().optional(),
});

const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .regex(/^\+?[0-9 ()/-]{5,}$/, "Bitte eine gültige Telefonnummer angeben.")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const returnChannelSchema = z
  .object({
    chat: chatToken,
    name: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((value) => value || undefined),
    channel: z.enum(["email", "phone", "whatsapp"]),
    email: z
      .email("Bitte eine gültige E-Mail-Adresse angeben.")
      .max(254)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    phone: optionalPhone,
  })
  .superRefine((value, ctx) => {
    if (value.channel === "email" && !value.email) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "Bitte Ihre E-Mail-Adresse angeben.",
      });
    }
    if (value.channel !== "email" && !value.phone) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Bitte Ihre Nummer angeben." });
    }
  });
export type ReturnChannelInput = z.infer<typeof returnChannelSchema>;

export const callbackRequestSchema = z.object({
  token: visitToken.optional(),
  slug: z.string().regex(/^[a-z0-9-]{3,80}$/),
  name: z.string().trim().min(1, "Bitte Ihren Namen angeben.").max(120),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^\+?[0-9 ()/-]{5,}$/, "Bitte eine gültige Telefonnummer angeben."),
  preferredTime: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value || undefined),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || undefined),
  /** Honeypot: humans never see or fill it. */
  website: z.string().max(0).optional(),
});
export type CallbackRequestInput = z.infer<typeof callbackRequestSchema>;

export const ownerMessageSchema = z.object({
  threadId: z.uuid(),
  body,
});

/** First issue per field, for forms. */
export function issuesByField(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    result[key] ??= issue.message;
  }
  return result;
}

export interface PresenceRow {
  availability: "auto" | "available" | "away";
  lastActiveAt: Date;
}

/** „Verfügbar“ when someone set it by hand or has the cockpit open (§7.4). */
export function isAvailable(rows: PresenceRow[], now = Date.now()): boolean {
  return rows.some(
    (row) =>
      row.availability === "available" ||
      (row.availability === "auto" && now - row.lastActiveAt.getTime() < PRESENCE_TTL_MS),
  );
}

export interface OfflineCheck {
  lastVisitorMessageAt: Date | null;
  lastOwnerMessageAt: Date | null;
  offlineNoticeAt: Date | null;
}

/**
 * The automatic notice is due once per unanswered stretch: the visitor
 * wrote, nobody answered for two minutes, and no notice went out since.
 */
export function offlineNoticeDue(thread: OfflineCheck, now = Date.now()): boolean {
  const asked = thread.lastVisitorMessageAt?.getTime();
  if (!asked || now - asked < OFFLINE_AFTER_MS) return false;
  if (thread.lastOwnerMessageAt && thread.lastOwnerMessageAt.getTime() >= asked) return false;
  if (thread.offlineNoticeAt && thread.offlineNoticeAt.getTime() >= asked) return false;
  return true;
}

/** The offline notice with the other ways to reach the owner. */
export function offlineNoticeText(message: string, alternatives: string[]): string {
  if (alternatives.length === 0) return message;
  return `${message} Sie erreichen mich auch ${joinGerman(alternatives)}.`;
}

export function joinGerman(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} oder ${items.at(-1)}`;
}

export const HANDOVER_TEXT =
  "Gern können wir auf WhatsApp weiterschreiben, dann geht nichts verloren.";
