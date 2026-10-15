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
