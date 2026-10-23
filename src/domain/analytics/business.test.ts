import { describe, expect, it } from "vitest";
import type { BucketTotals } from "../offers/totals";
import {
  acceptance,
  businessCsvRows,
  formatDays,
  monthlyCents,
  offerValueCents,
  sortRevenue,
  type CampaignRevenue,
} from "./business";

const bucket = (netCents: number): BucketTotals => ({
  linesCents: netCents,
  discountCents: 0,
  netCents,
  vat: [],
  vatCents: 0,
  totalCents: netCents,
});

describe("offer value", () => {
  it("adds twelve months of every recurring bucket to the one-off part", () => {
    expect(
      offerValueCents({
        buckets: {
          once: bucket(500_000),
          monthly: bucket(5_000),
          quarterly: bucket(30_000),
          yearly: bucket(12_000),
        },
      }),
    ).toBe(500_000 + 60_000 + 120_000 + 12_000);
  });

  it("is zero without buckets and works without a one-off part", () => {
    expect(offerValueCents({ buckets: {} })).toBe(0);
    expect(offerValueCents({ buckets: { halfyearly: bucket(9_000) } })).toBe(18_000);
  });
});

describe("monthly recurring revenue", () => {
  it("spreads the period net over its months", () => {
    expect(monthlyCents("monthly", 4_900)).toBe(4_900);
    expect(monthlyCents("quarterly", 15_000)).toBe(5_000);
    expect(monthlyCents("yearly", 60_000)).toBe(5_000);
  });
});

describe("acceptance", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 9, n, 10));

  it("counts the accepted share of answered offers and the days to acceptance", () => {
    const result = acceptance([
      { status: "accepted", sentAt: day(1), answeredAt: day(3) },
      { status: "accepted", sentAt: day(1), answeredAt: day(6) },
      { status: "declined", sentAt: day(2), answeredAt: day(20) },
    ]);
    expect(result).toEqual({ answered: 3, accepted: 2, rate: 2 / 3, avgDays: 3.5 });
  });

  it("has no rate and no duration without answers", () => {
    expect(acceptance([])).toEqual({ answered: 0, accepted: 0, rate: null, avgDays: null });
    expect(
      acceptance([{ status: "declined", sentAt: day(1), answeredAt: day(2) }]).avgDays,
    ).toBeNull();
  });
});

describe("formatDays", () => {
  it("reads naturally in German", () => {
    expect(formatDays(null)).toBe("–");
    expect(formatDays(0.4)).toBe("unter 1 Tag");
    expect(formatDays(1.02)).toBe("1 Tag");
    expect(formatDays(3.46)).toBe("3,5 Tage");
    expect(formatDays(12)).toBe("12 Tage");
  });
});

describe("sortRevenue", () => {
  it("puts the highest first and the offers without campaign last", () => {
    const rows: CampaignRevenue[] = [
      { campaignId: null, name: "Ohne Kampagne", netCents: 900_000, invoices: 3 },
      { campaignId: "a", name: "Cafés", netCents: 100_000, invoices: 1 },
      { campaignId: "b", name: "Physio", netCents: 400_000, invoices: 2 },
    ];
    expect(sortRevenue(rows).map((row) => row.name)).toEqual(["Physio", "Cafés", "Ohne Kampagne"]);
    expect(rows[0]?.campaignId).toBeNull();
  });
});

describe("businessCsvRows", () => {
  it("rounds the days and gives revenue per campaign its own header", () => {
    const offers = { sent: 2, volumeCents: 411_600, rate: 2 / 3, avgDays: 3.4583 };
    const rows = businessCsvRows({
      offers,
      previousOffers: { sent: 0, volumeCents: 0, rate: null, avgDays: null },
      revenue: {
        netCents: 300_000,
        byCampaign: [{ campaignId: "a", name: "Cafés", netCents: 300_000, invoices: 3 }],
      },
      previousRevenue: { netCents: 0 },
      open: { openCents: 260_000, overdueCents: 0 },
      contracts: { mrrCents: 9_300 },
    });
    expect(rows).toContainEqual(["Kennzahl", "Ø Tage bis zur Annahme", 3.5, null]);
    expect(rows).toContainEqual(["Kennzahl", "Annahmequote (%)", 66.7, null]);
    expect(rows.slice(-2)).toEqual([
      ["Umsatz je Kampagne", "Kampagne", "Umsatz netto (EUR)", "Rechnungen"],
      ["Umsatz je Kampagne", "Cafés", 3_000, 3],
    ]);
  });
});
