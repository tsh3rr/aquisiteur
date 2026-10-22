import { z } from "zod";

/**
 * Tax and billing settings of a workspace (§7.10, ADR-0067). The owner is an
 * Austrian sole trader; the small-business exemption applies without an
 * application from the first sale, so it is the default.
 */

export const TAX_MODES = ["small_business", "standard"] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  small_business: "Kleinunternehmer (ohne Umsatzsteuer)",
  standard: "Regelbesteuert (mit Umsatzsteuer)",
};

export const SMALL_BUSINESS_NOTE =
  "Der Rechnungsbetrag enthält gemäß § 6 Abs. 1 Z 27 UStG 1994 keine Umsatzsteuer.";

/** Austrian VAT id: ATU plus 8 digits. Other EU ids are accepted for customers later (7b). */
export const AUSTRIAN_VAT_ID = /^ATU\d{8}$/;

export const billingSettingsSchema = z.object({
  taxMode: z.enum(TAX_MODES).default("small_business"),
  /** UID of the owner; needed on invoices above 400 € once there is one. */
  vatId: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s/g, "").toUpperCase())
    .pipe(z.string().regex(AUSTRIAN_VAT_ID, "UID im Format ATU12345678."))
    .optional()
    .or(z.literal("").transform(() => undefined)),
  smallBusinessNote: z.string().trim().min(10).max(300).default(SMALL_BUSINESS_NOTE),
  /** Days a new offer stays valid after sending. */
  offerValidDays: z.number().int().min(1).max(365).default(30),
  offerIntro: z
    .string()
    .trim()
    .max(4000)
    .default(
      "vielen Dank für das Gespräch. Wie besprochen erhalten Sie hier mein Angebot. Sie können Optionen an- und abwählen und das Angebot direkt auf dieser Seite annehmen.",
    ),
  offerOutro: z
    .string()
    .trim()
    .max(4000)
    .default("Bei Fragen erreichen Sie mich jederzeit. Ich freue mich auf die Zusammenarbeit!"),
});
export type BillingSettings = z.output<typeof billingSettingsSchema>;

/** The tax line under prices on the offer page, the PDF and the exposé (§7.10). */
export function taxNote(settings: Pick<BillingSettings, "taxMode" | "smallBusinessNote">): string {
  return settings.taxMode === "small_business"
    ? settings.smallBusinessNote
    : "Alle Preise netto zuzüglich der angegebenen Umsatzsteuer.";
}
