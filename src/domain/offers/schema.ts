import { z } from "zod";

/**
 * The offer document (§7.10): what the owner edits as a draft and what each
 * sent version freezes. Money is in euro cents, quantities may have up to
 * three decimals (e.g. 1.5 hours). Validated with the same schema in the
 * editor, the server action and when a version is read back.
 */

export const BILLING_INTERVALS = ["once", "monthly", "quarterly", "halfyearly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export type RecurringInterval = Exclude<BillingInterval, "once">;

/** Months per recurring interval, for monthly equivalents and the maintenance term. */
export const INTERVAL_MONTHS: Record<RecurringInterval, number> = {
  monthly: 1,
  quarterly: 3,
  halfyearly: 6,
  yearly: 12,
};

/** Austrian VAT rates (§ 10 UStG); 0 for exempt or reverse-charge lines. */
export const VAT_RATES = [20, 13, 10, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

const MAX_CENTS = 100_000_000; // 1 million euros per line is plenty for a web agency.

const id = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,31}$/, "Ungültige Kennung.")
  .describe("Stable id within the offer, e.g. 'website' or 'v-pro'.");

const text = (max: number) => z.string().trim().min(1, "Bitte ausfüllen.").max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const cents = z
  .number()
  .int("Betrag in Cent als ganze Zahl.")
  .min(0, "Kein negativer Betrag.")
  .max(MAX_CENTS, "Betrag zu hoch.");

const quantity = z
  .number()
  .positive("Menge muss größer als 0 sein.")
  .max(100_000)
  .refine((value) => Math.round(value * 1000) === value * 1000, "Höchstens drei Nachkommastellen.");

export const vatRateSchema = z.union([z.literal(20), z.literal(13), z.literal(10), z.literal(0)]);

export const offerItemSchema = z
  .object({
    id,
    title: text(160),
    description: optionalText(1000),
    quantity: quantity.default(1),
    unit: z.string().trim().max(24).default("Pauschal"),
    unitPriceCents: cents,
    /** Line discount in percent, 0–100. */
    discountPercent: z.number().min(0).max(100).default(0),
    vatRate: vatRateSchema.default(20),
    billing: z.enum(BILLING_INTERVALS).default("once"),
    /** The customer may switch it off on the offer page. */
    optional: z.boolean().default(false),
    /** For optional lines: switched on when the page opens. */
    selected: z.boolean().default(true),
    /** Variants the line belongs to; empty: all variants. */
    variantIds: z.array(id).max(4).default([]),
  })
  .strict();
export type OfferItem = z.output<typeof offerItemSchema>;

export const offerVariantSchema = z
  .object({
    id,
    title: text(80),
    description: optionalText(400),
    /** Preselected on the offer page and used for the exposé's pricing block. */
    recommended: z.boolean().default(false),
  })
  .strict();
export type OfferVariant = z.output<typeof offerVariantSchema>;

export const MILESTONE_TRIGGERS = ["acceptance", "date", "milestone", "after_previous"] as const;
export type MilestoneTrigger = (typeof MILESTONE_TRIGGERS)[number];

export const milestoneSchema = z
  .object({
    id,
    title: text(120),
    /** Share of the one-off total. The last instalment always takes the rest. */
    share: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("percent"), value: z.number().gt(0).max(100) }).strict(),
      z.object({ kind: z.literal("amount"), cents: cents.min(1) }).strict(),
    ]),
    trigger: z.enum(MILESTONE_TRIGGERS).default("acceptance"),
    /** trigger "date": due on this day (YYYY-MM-DD). */
    date: z.iso.date().optional(),
    /** trigger "after_previous": days after the previous instalment. */
    days: z.number().int().min(1).max(730).optional(),
  })
  .strict()
  .superRefine((milestone, ctx) => {
    if (milestone.trigger === "date" && !milestone.date) {
      ctx.addIssue({ code: "custom", message: "Bitte ein Datum angeben.", path: ["date"] });
    }
    if (milestone.trigger === "after_previous" && !milestone.days) {
      ctx.addIssue({ code: "custom", message: "Bitte die Tage angeben.", path: ["days"] });
    }
  });
export type Milestone = z.output<typeof milestoneSchema>;

export const maintenanceTermsSchema = z
  .object({
    startOn: z.enum(["acceptance", "go_live", "date"]).default("go_live"),
    startDate: z.iso.date().optional(),
    minimumMonths: z.number().int().min(0).max(60).default(12),
    noticeMonths: z.number().int().min(0).max(12).default(3),
    /** Billed at the start of each period (usual) or after it. */
    timing: z.enum(["advance", "arrears"]).default("advance"),
    /** Wertsicherung (7c-3b): prices follow the VPI once a year, both ways. */
    indexed: z.boolean().default(false),
    /** Stundenkontingent (7c-3b): minutes included per period, and the rate for more. */
    includedMinutes: z.number().int().min(0).max(12_000).default(0),
    hourlyRateCents: z.number().int().min(0).max(10_000_000).optional(),
  })
  .strict();
export type MaintenanceTerms = z.output<typeof maintenanceTermsSchema>;

export const DEFAULT_PAYMENT_PLAN: Milestone[] = [
  {
    id: "m1",
    title: "Bei Auftrag",
    share: { kind: "percent", value: 100 },
    trigger: "acceptance",
  },
];

export const offerDocumentSchema = z
  .object({
    title: text(160),
    intro: optionalText(4000),
    outro: optionalText(4000),
    /** Days the offer stays valid after it is sent. */
    validDays: z.number().int().min(1).max(365).default(30),
    /** Gesamtrabatt in percent on the one-off lines; recurring lines keep their price. */
    discountPercent: z.number().min(0).max(100).default(0),
    variants: z.array(offerVariantSchema).max(4).default([]),
    items: z.array(offerItemSchema).max(60).default([]),
    paymentPlan: z.array(milestoneSchema).min(1).max(8).default(DEFAULT_PAYMENT_PLAN),
    maintenance: maintenanceTermsSchema.prefault({}),
  })
  .strict()
  .superRefine((offer, ctx) => {
    const unique = (values: string[], path: string, label: string) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          ctx.addIssue({
            code: "custom",
            message: `${label} „${value}“ ist doppelt.`,
            path: [path, index, "id"],
          });
        }
        seen.add(value);
      });
    };
    unique(
      offer.items.map((item) => item.id),
      "items",
      "Position",
    );
    unique(
      offer.variants.map((variant) => variant.id),
      "variants",
      "Variante",
    );
    unique(
      offer.paymentPlan.map((milestone) => milestone.id),
      "paymentPlan",
      "Tranche",
    );
    if (offer.variants.length === 1) {
      ctx.addIssue({
        code: "custom",
        message: "Varianten nur ab zwei, sonst die Variante weglassen.",
        path: ["variants"],
      });
    }
    if (offer.variants.filter((variant) => variant.recommended).length > 1) {
      ctx.addIssue({
        code: "custom",
        message: "Nur eine Variante kann empfohlen sein.",
        path: ["variants"],
      });
    }
    const variantIds = new Set(offer.variants.map((variant) => variant.id));
    offer.items.forEach((item, index) => {
      for (const variantId of item.variantIds) {
        if (!variantIds.has(variantId)) {
          ctx.addIssue({
            code: "custom",
            message: `Unbekannte Variante „${variantId}“.`,
            path: ["items", index, "variantIds"],
          });
        }
      }
    });
    const percents = offer.paymentPlan
      .slice(0, -1)
      .reduce(
        (sum, milestone) => sum + (milestone.share.kind === "percent" ? milestone.share.value : 0),
        0,
      );
    if (percents >= 100) {
      ctx.addIssue({
        code: "custom",
        message: "Die Tranchen vor der letzten ergeben schon 100 %; die letzte bekäme nichts.",
        path: ["paymentPlan"],
      });
    }
  });
export type OfferDocument = z.output<typeof offerDocumentSchema>;
export type OfferDocumentInput = z.input<typeof offerDocumentSchema>;

/** An offer that can be sent: at least one line and something to pay. */
export function sendIssues(offer: OfferDocument): string[] {
  const issues: string[] = [];
  if (offer.items.length === 0) issues.push("Das Angebot hat noch keine Position.");
  if (offer.variants.length > 0) {
    for (const variant of offer.variants) {
      if (
        !offer.items.some(
          (item) => item.variantIds.length === 0 || item.variantIds.includes(variant.id),
        )
      ) {
        issues.push(`Die Variante „${variant.title}“ hat keine Position.`);
      }
    }
  }
  return issues;
}

/** What the customer picked on the offer page. */
export const offerSelectionSchema = z
  .object({
    variantId: id.nullable().default(null),
    /** Optional lines the customer switched on. */
    optionalIds: z.array(id).max(60).default([]),
  })
  .strict();
export type OfferSelection = z.output<typeof offerSelectionSchema>;

export const OFFER_STATUSES = ["draft", "sent", "accepted", "declined", "withdrawn"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_STATUS_LABELS: Record<OfferStatus | "expired", string> = {
  draft: "Entwurf",
  sent: "Versendet",
  accepted: "Angenommen",
  declined: "Abgelehnt",
  withdrawn: "Zurückgezogen",
  expired: "Abgelaufen",
};

export const OFFER_STATUS_TONES: Record<
  OfferStatus | "expired",
  "neutral" | "accent" | "success" | "warning" | "danger"
> = {
  draft: "neutral",
  sent: "accent",
  accepted: "success",
  declined: "danger",
  withdrawn: "neutral",
  expired: "warning",
};

/** Sent offers past their validity show as expired without a job changing the row. */
export function displayStatus(
  status: OfferStatus,
  validUntil: string | null,
  today: string,
): OfferStatus | "expired" {
  if (status === "sent" && validUntil && validUntil < today) return "expired";
  return status;
}

export const UNITS = ["Pauschal", "Stk.", "Std.", "Seite", "Monat", "Jahr"] as const;

export const BILLING_LABELS: Record<BillingInterval, string> = {
  once: "einmalig",
  monthly: "monatlich",
  quarterly: "vierteljährlich",
  halfyearly: "halbjährlich",
  yearly: "jährlich",
};

export const PER_INTERVAL: Record<RecurringInterval, string> = {
  monthly: "pro Monat",
  quarterly: "pro Quartal",
  halfyearly: "pro Halbjahr",
  yearly: "pro Jahr",
};

export const TRIGGER_LABELS: Record<MilestoneTrigger, string> = {
  acceptance: "bei Auftrag",
  date: "am Datum",
  milestone: "bei Erreichen",
  after_previous: "Tage nach der vorigen",
};

/** Ready-made payment plans for the editor. */
export const PAYMENT_PLAN_PRESETS: { label: string; plan: Milestone[] }[] = [
  { label: "100 % bei Auftrag", plan: DEFAULT_PAYMENT_PLAN },
  {
    label: "50/50",
    plan: [
      {
        id: "m1",
        title: "Anzahlung bei Auftrag",
        share: { kind: "percent", value: 50 },
        trigger: "acceptance",
      },
      { id: "m2", title: "Go-live", share: { kind: "percent", value: 50 }, trigger: "milestone" },
    ],
  },
  {
    label: "30/40/30",
    plan: [
      {
        id: "m1",
        title: "Anzahlung bei Auftrag",
        share: { kind: "percent", value: 30 },
        trigger: "acceptance",
      },
      {
        id: "m2",
        title: "Design abgenommen",
        share: { kind: "percent", value: 40 },
        trigger: "milestone",
      },
      { id: "m3", title: "Go-live", share: { kind: "percent", value: 30 }, trigger: "milestone" },
    ],
  },
];
