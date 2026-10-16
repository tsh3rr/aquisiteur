import { z } from "zod";
import { scoreWeightsSchema } from "./intent/score";

/**
 * Typed shapes of the JSON columns in workspace_settings. Everything the
 * spec says must not be hard-coded (§9a) has its home here. Later phases
 * extend these schemas; defaults keep old rows valid.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

/** E.164-ish: digits, spaces, +, -, /, parentheses. Normalised for wa.me links later. */
const phone = z
  .string()
  .trim()
  .max(40)
  .regex(/^\+?[0-9 ()/-]{5,}$/, "Bitte eine gültige Telefonnummer angeben.")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const profileSchema = z.object({
  displayName: optionalText(120),
  role: optionalText(120),
  /** Owner photo shown in exposés (hero, signature, about). Row in `assets`. */
  photoAssetId: z.uuid().optional(),
});

export const channelsSchema = z.object({
  email: z
    .email("Bitte eine gültige E-Mail-Adresse angeben.")
    .max(254)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  phone,
  mobile: phone,
  whatsapp: phone,
  /** Facebook page name for m.me links (§7.4, prepared channel). */
  messengerPage: z
    .string()
    .trim()
    .max(100)
    .regex(/^[A-Za-z0-9.]+$/, "Nur der Seitenname, z. B. pixelwerk.leipzig.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  sms: phone,
  /** Booking page (Cal.com, Calendly …), opened in a new tab; nothing is embedded. */
  bookingUrl: z
    .url({ protocol: /^https$/, error: "Bitte eine https-Adresse angeben." })
    .max(300)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/** Live chat in exposés (§7.5). */
export const chatSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Shown in the chat header and the reading nudge. */
  responseTime: z.string().trim().max(120).default("Ich antworte meist innerhalb einer Stunde."),
  /** Sent automatically when nobody answers within two minutes. Channels are appended. */
  offlineMessage: z
    .string()
    .trim()
    .max(500)
    .default(
      "Danke für Ihre Nachricht! Ich bin gerade nicht am Rechner und melde mich so bald wie möglich.",
    ),
  /**
   * Store the text of unsent drafts (§7.5). Off by default: then only the
   * length is kept. When on, the widget says so above the text field.
   */
  storeDraftContent: z.boolean().default(false),
});

/** Behaviour-based nudges in exposés (§7.4). Each can be switched off. */
export const nudgeSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  readInvite: z.boolean().default(true),
  pricing: z.boolean().default(true),
  returning: z.boolean().default(true),
  exitIntent: z.boolean().default(true),
  stickyBar: z.boolean().default(true),
});

export const senderAddressSchema = z.object({
  company: optionalText(160),
  street: optionalText(160),
  postalCode: optionalText(10),
  city: optionalText(120),
  country: z.string().trim().length(2).default("DE"),
});

export const brandingSchema = z.object({
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** Agency logo. Row in `assets`. */
  logoAssetId: z.uuid().optional(),
});

export const legalSchema = z.object({
  imprintMarkdown: optionalText(20_000),
  privacyMarkdown: optionalText(50_000),
});

export const retentionSchema = z.object({
  eventsDays: z.number().int().min(30).max(3650).default(365),
  replaysDays: z.number().int().min(7).max(365).default(90),
  optOutTrackingDays: z.number().int().min(1).max(90).default(30),
});

/**
 * The printed letter (§7.9). Subject and body are used when the exposé has
 * no `letter` of its own; both may contain placeholders (see
 * src/domain/letters/compose.ts).
 */
export const letterSettingsSchema = z.object({
  subject: z.string().trim().max(160).default("Ein paar Ideen für {{firma}}"),
  body: z
    .string()
    .trim()
    .max(4000)
    .default(
      "ich bin über {{firma}} gestolpert und habe mir Ihren Auftritt im Netz genauer angesehen. Dabei sind mir ein paar Dinge eingefallen, die Ihnen mehr Anfragen bringen könnten.\n\nIch habe sie für Sie auf einer persönlichen Seite zusammengestellt, mit Beispielen und einem Preisrahmen. Scannen Sie einfach den QR-Code oder tippen Sie den Link ein.\n\nWenn Ihnen etwas davon gefällt, freue ich mich über eine kurze Nachricht.",
    ),
  closing: z.string().trim().max(80).default("Mit freundlichen Grüßen"),
  /** Hand signature as an image (PNG with transparency). Row in `assets`. */
  signatureAssetId: z.uuid().optional(),
  qrHint: z.string().trim().max(80).default("Scannen Sie den Code mit der Handy-Kamera."),
  /** Print and postage per letter for the `manual` provider, for the dashboards. */
  costCents: z.number().int().min(0).max(10_000).default(110),
});

/**
 * Session replay (§6.3): off by default. When on, the exposé asks each
 * visitor with a small notice; only a „Ja“ starts a recording.
 */
export const replaySettingsSchema = z.object({
  enabled: z.boolean().default(false),
});

/** An IANA time zone the runtime knows, e.g. "Europe/Berlin". */
export const timezoneSchema = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, "Unbekannte Zeitzone.");

/** Owner notifications (§7.7). The rules themselves live in notification_rules. */
export const notificationSettingsSchema = z.object({
  /** Quiet hours, weekdays and the digest hour are read in this zone. */
  timezone: timezoneSchema.catch("Europe/Berlin").default("Europe/Berlin"),
});

export const workspaceSettingsSchema = z.object({
  profile: profileSchema.prefault({}),
  channels: channelsSchema.prefault({}),
  senderAddress: senderAddressSchema.prefault({ country: "DE" }),
  branding: brandingSchema.prefault({}),
  legal: legalSchema.prefault({}),
  chat: chatSettingsSchema.prefault({}),
  nudges: nudgeSettingsSchema.prefault({}),
  scoreWeights: scoreWeightsSchema.prefault({}),
  notifications: notificationSettingsSchema.prefault({}),
  letter: letterSettingsSchema.prefault({}),
  replay: replaySettingsSchema.prefault({}),
  retention: retentionSchema.prefault({ eventsDays: 365, replaysDays: 90, optOutTrackingDays: 30 }),
});

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export type ProfileSettings = z.infer<typeof profileSchema>;
export type ChannelSettings = z.infer<typeof channelsSchema>;
export type SenderAddress = z.infer<typeof senderAddressSchema>;
export type ChatSettings = z.infer<typeof chatSettingsSchema>;
export type NudgeSettings = z.infer<typeof nudgeSettingsSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type LetterSettings = z.infer<typeof letterSettingsSchema>;
export type ReplaySettings = z.infer<typeof replaySettingsSchema>;
