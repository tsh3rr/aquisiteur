import { describe, expect, it } from "vitest";
import { formatEuro, pricingTotals } from "./pricing";

const option = (id: string, price: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  price,
  billing: "once" as const,
  selected: false,
  required: false,
  ...extra,
});

describe("pricingTotals()", () => {
  it("sums ranges, monthly options and always includes required ones", () => {
    const options = [
      option("site", 2400, { priceTo: 3200, required: true }),
      option("seo", 290),
      option("care", 49, { billing: "monthly" }),
    ];
    expect(pricingTotals(options, new Set(["seo", "care"]))).toEqual({
      once: { from: 2690, to: 3490 },
      monthly: { from: 49, to: 49 },
    });
    expect(pricingTotals(options, new Set())).toEqual({
      once: { from: 2400, to: 3200 },
      monthly: { from: 0, to: 0 },
    });
  });
});

describe("formatEuro()", () => {
  const intl = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

  it.each([0, 5, 49, 990, 1000, 4700, 12_345, 1_234_567, 89.5, 1999.4, -1200])(
    "matches Intl for %d",
    (amount) => {
      expect(formatEuro(amount)).toBe(intl.format(amount));
    },
  );
});
