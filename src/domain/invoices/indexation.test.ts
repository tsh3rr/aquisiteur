import { describe, expect, it } from "vitest";
import { fillTemplate } from "./email";
import {
  effectiveDate,
  formatChange,
  formatIndex,
  INDEX_EMAIL_BODY,
  indexChangePercent,
  indexedLines,
  indexEmailValues,
  monthLabel,
  nextCycle,
  nextIndexDate,
  parseIndex,
  planAdjustment,
  withinThreshold,
} from "./indexation";
import type { InvoiceLine } from "./schema";

const line: InvoiceLine = {
  id: "care",
  title: "Wartung",
  description: "",
  quantity: 1,
  unit: "Monat",
  unitPriceCents: 9_000,
  discountPercent: 0,
  vatRate: 20,
};

describe("index values", () => {
  it("parses and formats tenths", () => {
    expect(parseIndex("128,7")).toBe(1287);
    expect(parseIndex(" 132.6 ")).toBe(1326);
    expect(parseIndex("130")).toBe(1300);
    expect(parseIndex("128,75")).toBeNull();
    expect(parseIndex("0")).toBeNull();
    expect(parseIndex("abc")).toBeNull();
    expect(formatIndex(1287)).toBe("128,7");
    expect(monthLabel("2026-01")).toBe("Jänner 2026");
  });

  it("computes the change both ways", () => {
    expect(indexChangePercent(1287, 1326)).toBe(3.03);
    expect(formatChange(3.03)).toBe("+3,03 %");
    expect(formatChange(indexChangePercent(1326, 1300))).toBe("−1,96 %");
    expect(withinThreshold(1.5, 2)).toBe(true);
    expect(withinThreshold(-2, 2)).toBe(false);
    expect(withinThreshold(0, 0)).toBe(true);
    expect(withinThreshold(0.1, 0)).toBe(false);
  });

  it("scales unit prices to the cent", () => {
    expect(indexedLines([line], 1287, 1326)[0]!.unitPriceCents).toBe(9_273);
    expect(indexedLines([line], 1326, 1300)[0]!.unitPriceCents).toBe(8_824);
  });
});

describe("schedule", () => {
  it("waits at least a year after the start", () => {
    expect(nextIndexDate({ startDate: "2026-01-01", indexMonth: 1 }, null)).toBe("2027-01-01");
    expect(nextIndexDate({ startDate: "2026-03-15", indexMonth: 4 }, null)).toBe("2027-04-01");
    expect(nextIndexDate({ startDate: "2026-03-15", indexMonth: 1 }, null)).toBe("2028-01-01");
  });

  it("comes once a year after an adjustment", () => {
    expect(nextIndexDate({ startDate: "2026-01-01", indexMonth: 1 }, "2027-01-01")).toBe(
      "2028-01-01",
    );
    // A late one on 1 March keeps the next one at least eleven months away.
    expect(nextIndexDate({ startDate: "2026-01-01", indexMonth: 1 }, "2027-03-01")).toBe(
      "2029-01-01",
    );
  });

  it("starts with a full period after the notice", () => {
    expect(effectiveDate("monthly", "2027-01-01", "2026-11-20", 30)).toBe("2027-01-01");
    expect(effectiveDate("monthly", "2027-01-01", "2026-12-10", 30)).toBe("2027-02-01");
    expect(effectiveDate("quarterly", "2027-01-01", "2026-12-10", 30)).toBe("2027-04-01");
  });
});

describe("announcement", () => {
  it("lists old and new prices", () => {
    const values = indexEmailValues({
      contractTitle: "Website-Wartung",
      interval: "monthly",
      baseMonth: "2025-09",
      baseTenths: 1287,
      indexMonth: "2026-09",
      indexTenths: 1326,
      effectiveFrom: "2027-01-01",
      oldLines: [line],
      newLines: indexedLines([line], 1287, 1326),
      sender: "Studio Kapek",
    });
    const body = fillTemplate(INDEX_EMAIL_BODY, values);
    expect(body).toContain("von 128,7 (September 2025) auf 132,6 (September 2026) gestiegen");
    expect(body).toContain("+3,03 %");
    expect(body).toContain("Ab 01.01.2027");
    expect(values.aufstellung).toMatch(/^Wartung: 90,00\s€ → 92,73\s€ pro Monat \(netto\)$/);
  });
});

describe("planAdjustment", () => {
  const input = {
    lines: [line],
    interval: "monthly" as const,
    baseTenths: 1287,
    indexTenths: 1326,
    thresholdPercent: 2,
    dueOn: "2027-01-01",
    today: "2026-11-20",
    noticeDays: 30,
    billedUntil: "2026-12-31",
  };

  it("raises the prices from the due period", () => {
    expect(planAdjustment(input)).toMatchObject({
      changePercent: 3.03,
      within: false,
      effectiveFrom: "2027-01-01",
    });
  });

  it("keeps a period billed in advance at the old price", () => {
    expect(planAdjustment({ ...input, billedUntil: "2027-01-31" }).effectiveFrom).toBe(
      "2027-02-01",
    );
  });

  it("changes nothing inside the threshold", () => {
    const plan = planAdjustment({ ...input, indexTenths: 1300 });
    expect(plan.within).toBe(true);
    expect(plan.newLines).toEqual([line]);
  });
});

describe("nextCycle", () => {
  const contract = { indexed: true, startDate: "2026-01-01", endDate: null, indexMonth: 1 };

  it("follows the last decided cycle", () => {
    expect(nextCycle(contract, [])).toBe("2027-01-01");
    expect(
      nextCycle(contract, [{ status: "skipped", dueOn: "2027-01-01", effectiveFrom: null }]),
    ).toBe("2028-01-01");
    expect(
      nextCycle(contract, [
        { status: "withdrawn", dueOn: "2027-01-01", effectiveFrom: "2027-01-01" },
      ]),
    ).toBe("2027-01-01");
  });

  it("stays yearly after a late announcement", () => {
    expect(
      nextCycle({ ...contract, startDate: "2026-01-01" }, [
        { status: "applied", dueOn: "2027-01-01", effectiveFrom: "2027-04-01" },
      ]),
    ).toBe("2028-01-01");
  });

  it("is null when not indexed or ended before", () => {
    expect(nextCycle({ ...contract, indexed: false }, [])).toBeNull();
    expect(nextCycle({ ...contract, endDate: "2026-12-31" }, [])).toBeNull();
  });
});
