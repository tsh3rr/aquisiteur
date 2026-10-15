import { z } from "zod";

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
  /** Prepared channels (§4.4): stored now, used once the adapters exist. */
  messengerPage: optionalText(200),
  sms: phone,
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

export const workspaceSettingsSchema = z.object({
  profile: profileSchema.prefault({}),
  channels: channelsSchema.prefault({}),
  senderAddress: senderAddressSchema.prefault({ country: "DE" }),
  branding: brandingSchema.prefault({}),
  legal: legalSchema.prefault({}),
  retention: retentionSchema.prefault({ eventsDays: 365, replaysDays: 90, optOutTrackingDays: 30 }),
});

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export type ProfileSettings = z.infer<typeof profileSchema>;
export type ChannelSettings = z.infer<typeof channelsSchema>;
export type SenderAddress = z.infer<typeof senderAddressSchema>;
