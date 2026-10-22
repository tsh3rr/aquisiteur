import { describe, expect, it } from "vitest";
import { pricingOptionsFromOffer } from "./to-pricing";
import { displayStatus, offerDocumentSchema, type OfferDocumentInput, sendIssues } from "./schema";
import {
  defaultSelection,
  formatCents,
  normaliseSelection,
  offerTotals,
  parseEuroInput,
  paymentPlan,
} from "./totals";

const offer = (input: Partial<OfferDocumentInput> = {}) =>
  offerDocumentSchema.parse({ title: "Website-Relaunch", ...input });

const website = { id: "website", title: "Website", unitPriceCents: 450_000 };
const pages = {
  id: "pages",
  title: "Zusatzseite",
  quantity: 3,
  unit: "Seite",
  unitPriceCents: 25_000,
};
const seo = {
  id: "seo",
  title: "SEO-Start",
  unitPriceCents: 60_000,
  optional: true,
  selected: false,
};
const care = {
  id: "care",
  title: "Wartung",
  unitPriceCents: 4_900,
  billing: "monthly" as const,
  unit: "Monat",
};

describe("offerDocumentSchema", () => {
  it("fills sensible defaults", () => {
    const parsed = offer();
    expect(parsed.validDays).toBe(30);
    expect(parsed.paymentPlan).toHaveLength(1);
    expect(parsed.maintenance.minimumMonths).toBe(12);
  });

  it("rejects duplicate ids, a single variant and unknown variant references", () => {
    const result = offerDocumentSchema.safeParse({
      title: "X",
      variants: [{ id: "solo", title: "Solo" }],
      items: [website, { ...website }, { ...pages, variantIds: ["nope"] }],
    });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain("doppelt");
    expect(messages).toContain("ab zwei");
    expect(messages).toContain("Unbekannte Variante");
  });

  it("rejects a plan whose instalments before the last already reach 100 %", () => {
    const result = offerDocumentSchema.safeParse({
      title: "X",
      paymentPlan: [
        { id: "m1", title: "A", share: { kind: "percent", value: 100 } },
        { id: "m2", title: "B", share: { kind: "percent", value: 10 } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("needs a date or days for the matching trigger", () => {
    const result = offerDocumentSchema.safeParse({
      title: "X",
      paymentPlan: [
        { id: "m1", title: "A", share: { kind: "percent", value: 100 }, trigger: "date" },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("offerTotals()", () => {
  it("adds lines, quantities and line discounts in cents", () => {
    const doc = offer({ items: [website, pages, { ...seo, discountPercent: 10 }] });
    const totals = offerTotals(doc, { variantId: null, optionalIds: ["seo"] }, "small_business");
    expect(totals.lines.map((line) => line.netCents)).toEqual([450_000, 75_000, 54_000]);
    expect(totals.buckets.once).toEqual({
      linesCents: 579_000,
      discountCents: 0,
      netCents: 579_000,
      vat: [],
      vatCents: 0,
      totalCents: 579_000,
    });
  });

  it("leaves out optional lines that are not chosen", () => {
    const doc = offer({ items: [website, seo] });
    expect(offerTotals(doc, defaultSelection(doc), "small_business").buckets.once?.totalCents).toBe(
      450_000,
    );
  });

  it("computes VAT per rate on the sum when the workspace charges VAT", () => {
    const doc = offer({
      items: [
        { id: "aa", title: "A", unitPriceCents: 333, quantity: 3 },
        { id: "bb", title: "B", unitPriceCents: 1_000, vatRate: 10 },
      ],
    });
    const once = offerTotals(doc, defaultSelection(doc), "standard").buckets.once!;
    expect(once.vat).toEqual([
      { rate: 20, baseCents: 999, vatCents: 200 },
      { rate: 10, baseCents: 1_000, vatCents: 100 },
    ]);
    expect(once.totalCents).toBe(2_299);
  });

  it("keeps recurring lines in their own bucket", () => {
    const doc = offer({ items: [website, care] });
    const totals = offerTotals(doc, defaultSelection(doc), "small_business");
    expect(totals.buckets.once?.totalCents).toBe(450_000);
    expect(totals.buckets.monthly?.totalCents).toBe(4_900);
  });

  it("uses the lines of the chosen variant", () => {
    const doc = offer({
      variants: [
        { id: "starter", title: "Starter" },
        { id: "pro", title: "Pro", recommended: true },
      ],
      items: [
        { ...website, variantIds: ["starter"], unitPriceCents: 250_000 },
        { ...website, id: "website-pro", variantIds: ["pro"] },
        care,
      ],
    });
    expect(defaultSelection(doc).variantId).toBe("pro");
    const starter = offerTotals(doc, { variantId: "starter", optionalIds: [] }, "small_business");
    expect(starter.lines.map((line) => line.id)).toEqual(["website", "care"]);
    const unknown = normaliseSelection(doc, { variantId: "gold", optionalIds: ["website"] });
    expect(unknown).toEqual({ variantId: "pro", optionalIds: [] });
  });
});

describe("Gesamtrabatt", () => {
  it("lowers each VAT base of the one-off lines and leaves recurring lines alone", () => {
    const doc = offer({
      discountPercent: 10,
      items: [website, { ...pages, vatRate: 13 }, care],
    });
    const totals = offerTotals(doc, defaultSelection(doc), "standard");
    expect(totals.buckets.once).toMatchObject({
      linesCents: 525_000,
      discountCents: 52_500,
      netCents: 472_500,
      vat: [
        { rate: 20, baseCents: 405_000, vatCents: 81_000 },
        { rate: 13, baseCents: 67_500, vatCents: 8_775 },
      ],
      totalCents: 562_275,
    });
    expect(totals.buckets.monthly).toMatchObject({ discountCents: 0, totalCents: 5_880 });
  });

  it("goes into the one-off prices in the exposé", () => {
    const options = pricingOptionsFromOffer(offer({ discountPercent: 10, items: [website, care] }));
    expect(options.map((option) => option.price)).toEqual([4050, 49]);
    expect(options[0]!.description).toBe("inkl. 10 % Gesamtrabatt");
  });
});

describe("paymentPlan()", () => {
  it("lets the last instalment take the rounding rest", () => {
    const plan = paymentPlan(
      offer({
        paymentPlan: [
          { id: "m1", title: "A", share: { kind: "percent", value: 33.33 } },
          { id: "m2", title: "B", share: { kind: "percent", value: 33.33 } },
          { id: "m3", title: "C", share: { kind: "percent", value: 33.34 } },
        ],
      }).paymentPlan,
      100_001,
    );
    expect(plan.instalments.map((i) => i.amountCents)).toEqual([33_330, 33_330, 33_341]);
    expect(plan.instalments.at(-1)?.shareLabel).toBe("Rest");
    expect(plan.overbooked).toBe(false);
  });

  it("flags fixed amounts above the total", () => {
    const plan = paymentPlan(
      offer({
        paymentPlan: [
          { id: "m1", title: "A", share: { kind: "amount", cents: 200_000 } },
          { id: "m2", title: "B", share: { kind: "percent", value: 50 } },
        ],
      }).paymentPlan,
      100_000,
    );
    expect(plan.overbooked).toBe(true);
    // Capped at what is left, so no instalment turns negative.
    expect(plan.instalments.map((instalment) => instalment.amountCents)).toEqual([100_000, 0]);
  });
});

describe("helpers", () => {
  it("formats and parses euro amounts", () => {
    expect(formatCents(123_456)).toBe("1.234,56 €");
    expect(formatCents(5)).toBe("0,05 €");
    expect(parseEuroInput("1.234,5")).toBe(123_450);
    expect(parseEuroInput("1234.50")).toBe(123_450);
    expect(parseEuroInput("49")).toBe(4_900);
    expect(parseEuroInput("abc")).toBeNull();
  });

  it("names a sent offer past its validity expired", () => {
    expect(displayStatus("sent", "2026-10-01", "2026-10-22")).toBe("expired");
    expect(displayStatus("accepted", "2026-10-01", "2026-10-22")).toBe("accepted");
  });

  it("reports what blocks sending", () => {
    expect(sendIssues(offer())).toEqual(["Das Angebot hat noch keine Position."]);
    expect(sendIssues(offer({ items: [website] }))).toEqual([]);
  });

  it("turns offer lines into exposé pricing options", () => {
    const doc = offer({
      items: [
        website,
        seo,
        { id: "hosting", title: "Hosting", unitPriceCents: 24_000, billing: "yearly" },
      ],
    });
    expect(pricingOptionsFromOffer(doc)).toEqual([
      {
        id: "website",
        title: "Website",
        price: 4500,
        billing: "once",
        selected: true,
        required: true,
      },
      {
        id: "seo",
        title: "SEO-Start",
        price: 600,
        billing: "once",
        selected: false,
        required: false,
      },
      {
        id: "hosting",
        title: "Hosting",
        description: "Abrechnung jährlich (240,00 €)",
        price: 20,
        billing: "monthly",
        selected: true,
        required: true,
      },
    ]);
  });
});
