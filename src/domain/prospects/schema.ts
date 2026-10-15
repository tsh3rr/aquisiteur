import { z } from "zod";
import { PROSPECT_STATUSES } from "./status";

/** Empty form fields become null; everything else is trimmed. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Höchstens ${max} Zeichen.`)
    .transform((value) => value || null)
    .nullable()
    .optional()
    .transform((value) => value ?? null);

/** Prospect master data as edited in the cockpit (§7.1). */
export const prospectFormSchema = z.object({
  companyName: z.string().trim().min(1, "Bitte den Firmennamen angeben.").max(200),
  industry: optionalText(100),
  website: optionalText(300).refine(
    (value) => value === null || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(value),
    "Bitte eine vollständige Adresse mit https:// angeben.",
  ),
  street: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(100),
  phone: optionalText(50),
  email: optionalText(200).refine(
    (value) => value === null || z.email().safeParse(value).success,
    "Bitte eine gültige E-Mail-Adresse angeben.",
  ),
  notes: optionalText(10_000),
  tags: z
    .string()
    .optional()
    .transform((value) =>
      [
        ...new Set(
          (value ?? "")
            .split(",")
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean),
        ),
      ].slice(0, 20),
    )
    .pipe(z.array(z.string().max(40, "Tags sind höchstens 40 Zeichen lang."))),
  estimatedValue: z
    .string()
    .optional()
    .transform((value, ctx) => {
      const text = (value ?? "").replace(/[€\s.]/g, "").replace(",", ".");
      if (!text) return null;
      const euros = Number(text);
      if (!Number.isFinite(euros) || euros < 0 || euros > 10_000_000) {
        ctx.addIssue({ code: "custom", message: "Bitte einen Betrag in Euro angeben." });
        return z.NEVER;
      }
      return Math.round(euros * 100);
    }),
});

export type ProspectForm = z.output<typeof prospectFormSchema>;

export const contactFormSchema = z.object({
  salutation: optionalText(20),
  firstName: optionalText(100),
  lastName: optionalText(100),
  role: optionalText(100),
  email: optionalText(200).refine(
    (value) => value === null || z.email().safeParse(value).success,
    "Bitte eine gültige E-Mail-Adresse angeben.",
  ),
  phone: optionalText(50),
});

export const statusSchema = z.enum(PROSPECT_STATUSES);

/** First error message per field, for <Field error=…>. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}
