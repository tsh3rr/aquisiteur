import { z } from "zod";
import { channelsSchema, profileSchema, senderAddressSchema } from "./workspace-settings";

/** Form schemas of the onboarding wizard (§9a "Onboarding als Flow"). */

export const ONBOARDING_STEPS = [
  { id: 1, title: "Workspace" },
  { id: 2, title: "Profil & Kanäle" },
  { id: 3, title: "Absender & Domain" },
  { id: 4, title: "Passkey" },
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]["id"];

export const workspaceStepSchema = z.object({
  name: z.string().trim().min(2, "Bitte mindestens 2 Zeichen.").max(80, "Höchstens 80 Zeichen."),
  slug: z.string().trim().toLowerCase(),
});

export const profileStepSchema = z.object({
  profile: profileSchema.pick({ displayName: true, role: true }).extend({
    displayName: z.string().trim().min(2, "Bitte Ihren Namen angeben.").max(120),
  }),
  channels: channelsSchema.pick({ email: true, phone: true, mobile: true, whatsapp: true }),
});

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    "Bitte eine Domain wie go.agentur.de angeben, ohne https://.",
  );

export const senderStepSchema = z.object({
  senderAddress: senderAddressSchema.extend({
    company: z.string().trim().min(2, "Bitte den Absendernamen angeben.").max(160),
    street: z.string().trim().min(3, "Bitte Straße und Hausnummer angeben.").max(160),
    postalCode: z.string().trim().regex(/^\d{5}$/, "Bitte eine fünfstellige PLZ angeben."),
    city: z.string().trim().min(2, "Bitte den Ort angeben.").max(120),
  }),
  customDomain: hostname.optional().or(z.literal("").transform(() => undefined)),
});

export type FieldErrors = Record<string, string>;

/** Flattens Zod issues into { "a.b": "message" } for form fields. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    result[key] ??= issue.message;
  }
  return result;
}

export const slugProblemMessages = {
  too_short: "Mindestens 3 Zeichen.",
  too_long: "Höchstens 40 Zeichen.",
  invalid_chars: "Nur Kleinbuchstaben, Ziffern und Bindestriche.",
  reserved: "Diese Adresse ist reserviert.",
  slug_taken: "Diese Adresse ist schon vergeben.",
} as const;
