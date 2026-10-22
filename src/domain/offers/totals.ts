import type { TaxMode } from "../billing";
import {
  BILLING_INTERVALS,
  type BillingInterval,
  type Milestone,
  type OfferDocument,
  type OfferItem,
  type OfferSelection,
  type VatRate,
} from "./schema";

/**
 * Offer arithmetic (§7.10). Pure and integer-only: every line is rounded to
 * whole cents (half up), VAT is computed per rate on the sum of the lines,
 * so the totals match what an invoice will later show.
 */

export interface OfferLine {
  id: string;
  title: string;
  description: string | undefined;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  /** Before the line discount. */
  grossLineCents: number;
  discountCents: number;
  netCents: number;
  vatRate: VatRate;
  billing: BillingInterval;
  optional: boolean;
}

export interface VatAmount {
  rate: VatRate;
  baseCents: number;
  vatCents: number;
}

export interface BucketTotals {
  /** Sum of the lines before the overall discount. */
  linesCents: number;
  /** Gesamtrabatt, only on the one-off bucket. */
  discountCents: number;
  netCents: number;
  vat: VatAmount[];
  vatCents: number;
  totalCents: number;
}

export interface OfferTotals {
  lines: OfferLine[];
  /** Per billing interval that has at least one line; `once` first. */
  buckets: Partial<Record<BillingInterval, BucketTotals>>;
  taxMode: TaxMode;
}

/** Half-up rounding that does not drift on .5 values produced by floats. */
export function roundCents(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON);
}

/** Lines that belong to the chosen variant (all lines when there are no variants). */
export function variantItems(offer: OfferDocument, variantId: string | null): OfferItem[] {
  return offer.items.filter(
    (item) =>
      item.variantIds.length === 0 || (variantId !== null && item.variantIds.includes(variantId)),
  );
}

/** The variant the page preselects: the recommended one, else the first; null without variants. */
export function defaultVariantId(offer: OfferDocument): string | null {
  if (offer.variants.length === 0) return null;
  return (offer.variants.find((variant) => variant.recommended) ?? offer.variants[0]!).id;
}

/** The selection the offer page opens with. */
export function defaultSelection(offer: OfferDocument): OfferSelection {
  const variantId = defaultVariantId(offer);
  return {
    variantId,
    optionalIds: variantItems(offer, variantId)
      .filter((item) => item.optional && item.selected)
      .map((item) => item.id),
  };
}

/**
 * Brings a selection into line with the offer: an unknown variant falls back
 * to the default one, optional ids outside the variant are dropped.
 */
export function normaliseSelection(
  offer: OfferDocument,
  selection: OfferSelection,
): OfferSelection {
  const variantId =
    offer.variants.length === 0
      ? null
      : offer.variants.some((variant) => variant.id === selection.variantId)
        ? selection.variantId
        : defaultVariantId(offer);
  const optional = new Set(
    variantItems(offer, variantId)
      .filter((item) => item.optional)
      .map((item) => item.id),
  );
  return {
    variantId,
    optionalIds: [...new Set(selection.optionalIds)].filter((itemId) => optional.has(itemId)),
  };
}

export function lineFor(item: OfferItem): OfferLine {
  const grossLineCents = roundCents(item.quantity * item.unitPriceCents);
  const discountCents = roundCents((grossLineCents * item.discountPercent) / 100);
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitPriceCents: item.unitPriceCents,
    grossLineCents,
    discountCents,
    netCents: grossLineCents - discountCents,
    vatRate: item.vatRate,
    billing: item.billing,
    optional: item.optional,
  };
}

function bucketFor(lines: OfferLine[], taxMode: TaxMode, discountPercent = 0): BucketTotals {
  // Per rate, so the discount lowers each VAT base and invoices can show it the same way.
  const byRate = new Map<VatRate, number>();
  for (const line of lines) {
    byRate.set(line.vatRate, (byRate.get(line.vatRate) ?? 0) + line.netCents);
  }
  const bases = [...byRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, linesCents]) => {
      const discountCents = roundCents((linesCents * discountPercent) / 100);
      return { rate, linesCents, discountCents, baseCents: linesCents - discountCents };
    });
  const linesCents = bases.reduce((sum, entry) => sum + entry.linesCents, 0);
  const discountCents = bases.reduce((sum, entry) => sum + entry.discountCents, 0);
  const netCents = linesCents - discountCents;
  if (taxMode === "small_business") {
    return { linesCents, discountCents, netCents, vat: [], vatCents: 0, totalCents: netCents };
  }
  const vat = bases.map(({ rate, baseCents }) => ({
    rate,
    baseCents,
    vatCents: roundCents((baseCents * rate) / 100),
  }));
  const vatCents = vat.reduce((sum, entry) => sum + entry.vatCents, 0);
  return { linesCents, discountCents, netCents, vat, vatCents, totalCents: netCents + vatCents };
}

/** Lines and totals for a selection, split into one-off and recurring buckets. */
export function offerTotals(
  offer: OfferDocument,
  selection: OfferSelection,
  taxMode: TaxMode,
): OfferTotals {
  const { variantId, optionalIds } = normaliseSelection(offer, selection);
  const chosen = new Set(optionalIds);
  const lines = variantItems(offer, variantId)
    .filter((item) => !item.optional || chosen.has(item.id))
    .map(lineFor);
  const buckets: OfferTotals["buckets"] = {};
  for (const interval of BILLING_INTERVALS) {
    const inBucket = lines.filter((line) => line.billing === interval);
    if (inBucket.length > 0) {
      buckets[interval] = bucketFor(
        inBucket,
        taxMode,
        interval === "once" ? offer.discountPercent : 0,
      );
    }
  }
  return { lines, buckets, taxMode };
}

export interface Instalment {
  id: string;
  title: string;
  trigger: Milestone["trigger"];
  date: string | undefined;
  days: number | undefined;
  /** As entered: "30 %" or a fixed amount; the last one says "Rest". */
  shareLabel: string;
  amountCents: number;
}

export interface PaymentPlan {
  instalments: Instalment[];
  /** Fixed amounts and percentages before the last instalment exceed the total; they were capped. */
  overbooked: boolean;
}

/**
 * Splits the one-off total into instalments (§7.10 Tranchen): percentages are
 * rounded to cents, fixed amounts taken as they are, and the last instalment
 * takes whatever is left, so the plan always adds up to the total.
 */
export function paymentPlan(milestones: readonly Milestone[], totalCents: number): PaymentPlan {
  let assigned = 0;
  let overbooked = false;
  const instalments = milestones.map((milestone, index): Instalment => {
    const last = index === milestones.length - 1;
    const share = milestone.share;
    const remaining = Math.max(0, totalCents - assigned);
    let amountCents: number;
    if (last) amountCents = remaining;
    else {
      const wanted =
        share.kind === "percent" ? roundCents((totalCents * share.value) / 100) : share.cents;
      // Never more than what is left: a smaller selection on the offer page
      // must not turn the last instalment negative.
      if (wanted > remaining) overbooked = true;
      amountCents = Math.min(wanted, remaining);
    }
    assigned += amountCents;
    return {
      id: milestone.id,
      title: milestone.title,
      trigger: milestone.trigger,
      date: milestone.date,
      days: milestone.days,
      shareLabel:
        last && milestones.length > 1
          ? "Rest"
          : share.kind === "percent"
            ? `${formatPercent(share.value)} %`
            : "Festbetrag",
      amountCents,
    };
  });
  return { instalments, overbooked };
}

function formatPercent(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

/** "1.234,50 €": German notation without Intl, safe for the public page (ADR-0048). */
export function formatCents(amount: number): string {
  const negative = amount < 0;
  const abs = Math.abs(Math.round(amount));
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const rest = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${euros},${rest} €`;
}

/** "1,5" for quantities, without trailing zeros. */
export function formatQuantity(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace(".", ",");
}

/** Parses "1.234,50", "1234.5" or "1234" into cents; null when it is not a number. */
export function parseEuroInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s|€/g, "");
  if (!cleaned) return null;
  const normalised = /,\d{1,2}$/.test(cleaned)
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;
  return roundCents(Number(normalised) * 100);
}
