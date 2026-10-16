import type { BlockOf } from "./schema";

type Option = BlockOf<"pricing">["options"][number];

/** Sums selected options (required ones always count), split by billing. */
export function pricingTotals(options: readonly Option[], selected: ReadonlySet<string>) {
  const totals = { once: { from: 0, to: 0 }, monthly: { from: 0, to: 0 } };
  for (const option of options) {
    if (!option.required && !selected.has(option.id)) continue;
    const bucket = option.billing === "monthly" ? totals.monthly : totals.once;
    bucket.from += option.price;
    bucket.to += option.priceTo ?? option.price;
  }
  return totals;
}

/**
 * Whole euros in German notation ("4.700 €"), the same output as
 * Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR",
 * maximumFractionDigits: 0 }). Hand-written because the first Intl formatter
 * in a page loads locale data on the main thread (about 60 ms on a throttled
 * phone), right inside the exposé's hydration (ADR-0048).
 */
export function formatEuro(amount: number) {
  const rounded = Math.round(amount);
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${rounded < 0 ? "-" : ""}${digits} €`;
}
