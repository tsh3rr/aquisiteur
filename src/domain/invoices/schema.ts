import { z } from "zod";
import { cents, vatRateSchema, type VatRate } from "../offers/schema";

/**
 * Invoices under Austrian law (§7.10, phase 7b, ADR-0070). A draft is edited
 * freely; issuing assigns the number, freezes document, totals, issuer and
 * recipient and stores a checksum. Money is in euro cents.
 */

export const INVOICE_KINDS = ["standard", "deposit", "final", "cancellation"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  standard: "Rechnung",
  deposit: "Anzahlungsrechnung",
  final: "Schlussrechnung",
  cancellation: "Stornorechnung",
};

export const INVOICE_STATUSES = ["draft", "issued", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** What the list shows: issued invoices split by payment. */
export type InvoiceDisplayStatus =
  "draft" | "open" | "partly_paid" | "paid" | "overdue" | "cancelled" | "storno";

export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  draft: "Entwurf",
  open: "Offen",
  partly_paid: "Teilweise bezahlt",
  paid: "Bezahlt",
  overdue: "Überfällig",
  cancelled: "Storniert",
  storno: "Storno",
};

export const INVOICE_STATUS_TONES: Record<
  InvoiceDisplayStatus,
  "neutral" | "accent" | "success" | "warning" | "danger"
> = {
  draft: "neutral",
  open: "accent",
  partly_paid: "warning",
  paid: "success",
  overdue: "danger",
  cancelled: "neutral",
  storno: "neutral",
};

/**
 * How VAT is treated (§ 6, § 3a, § 19 UStG). Derived from the workspace's
 * tax mode and the customer's country and UID, overridable per invoice.
 */
export const TAX_TREATMENTS = [
  "small_business",
  "domestic",
  "reverse_charge",
  "non_taxable",
] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  small_business: "Kleinunternehmer, ohne Umsatzsteuer",
  domestic: "Mit österreichischer Umsatzsteuer",
  reverse_charge: "Reverse Charge (EU-Unternehmen mit UID)",
  non_taxable: "Nicht steuerbar in Österreich (Unternehmen im Drittland)",
};

/** Treatments that show no VAT on the invoice. */
export const WITHOUT_VAT: ReadonlySet<TaxTreatment> = new Set([
  "small_business",
  "reverse_charge",
  "non_taxable",
]);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

/** EU VAT id: two letters and 2–12 characters; checked against VIES later (7c). */
export const VAT_ID = /^[A-Z]{2}[0-9A-Z+*.]{2,12}$/;

const vatId = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s.-]/g, "").toUpperCase())
  .pipe(z.string().regex(VAT_ID, "UID im Format ATU12345678 oder DE123456789."))
  .optional()
  .or(z.literal("").transform(() => undefined));

/** The customer's billing profile (§7.10), stored on the prospect. */
export const billingProfileSchema = z.object({
  /** "business" customers can get reverse charge and need a UID above 10.000 €. */
  customerType: z.enum(["business", "consumer"]).default("business"),
  /** Name on the invoice; empty: the company name. */
  name: optionalText(160),
  /** A billing address other than the one in the master data. */
  street: optionalText(160),
  postalCode: optionalText(10),
  city: optionalText(120),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  vatId,
  email: z
    .email("Bitte eine gültige E-Mail-Adresse angeben.")
    .max(254)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Days until payment; empty: the workspace default. */
  paymentTermsDays: z.number().int().min(0).max(120).optional(),
});
export type BillingProfile = z.output<typeof billingProfileSchema>;

/** Name and address on the invoice, frozen when it is issued. */
export interface InvoiceParty {
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  vatId: string | null;
}

export interface InvoiceIssuer extends InvoiceParty {
  email: string | null;
  iban: string | null;
  bic: string | null;
  bankName: string | null;
}

const lineId = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, "Ungültige Kennung.");

const quantity = z
  .number()
  .positive("Menge muss größer als 0 sein.")
  .max(100_000)
  .refine((value) => Math.round(value * 1000) === value * 1000, "Höchstens drei Nachkommastellen.");

export const invoiceLineSchema = z
  .object({
    id: lineId,
    title: z.string().trim().min(1, "Bitte ausfüllen.").max(160),
    description: optionalText(1000),
    quantity: quantity.default(1),
    unit: z.string().trim().max(24).default("Pauschal"),
    unitPriceCents: cents,
    discountPercent: z.number().min(0).max(100).default(0),
    vatRate: vatRateSchema.default(20),
  })
  .strict();
export type InvoiceLine = z.output<typeof invoiceLineSchema>;

/** A deposit invoice the final invoice subtracts, with its frozen amounts per rate. */
export const invoiceDeductionSchema = z
  .object({
    invoiceId: z.uuid(),
    number: z.string(),
    issueDate: z.iso.date(),
    byRate: z.array(
      z.object({ rate: vatRateSchema, netCents: z.number().int(), vatCents: z.number().int() }),
    ),
  })
  .strict();
export type InvoiceDeduction = z.output<typeof invoiceDeductionSchema>;

export const servicePeriodSchema = z
  .object({
    from: z.iso.date({ error: "Bitte das Leistungsdatum angeben." }),
    /** Empty for a single service date. */
    to: z.iso.date().optional(),
  })
  .strict()
  .refine((period) => !period.to || period.to >= period.from, {
    message: "Das Ende liegt vor dem Beginn.",
    path: ["to"],
  });

export const invoiceDocumentSchema = z
  .object({
    title: z.string().trim().max(160).default(""),
    intro: optionalText(4000),
    outro: optionalText(4000),
    lines: z.array(invoiceLineSchema).max(60).default([]),
    /** Overall discount on all lines, in percent (from the offer's Gesamtrabatt). */
    discountPercent: z.number().min(0).max(100).default(0),
    deductions: z.array(invoiceDeductionSchema).max(20).default([]),
    servicePeriod: servicePeriodSchema.optional(),
    paymentTermsDays: z.number().int().min(0).max(120).default(14),
    treatment: z.enum(TAX_TREATMENTS).default("small_business"),
    /** Replaces the default tax note, e.g. for a case agreed with the tax adviser. */
    taxNote: optionalText(400),
  })
  .strict();
export type InvoiceDocument = z.output<typeof invoiceDocumentSchema>;

export interface RateAmount {
  rate: VatRate;
  netCents: number;
  vatCents: number;
}
