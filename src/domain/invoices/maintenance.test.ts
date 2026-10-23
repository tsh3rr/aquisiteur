import { describe, expect, it } from "vitest";
import {
  addMonths,
  calendarPeriod,
  contractState,
  duePeriods,
  earliestEnd,
  nextPeriod,
  periodLines,
  sameLines,
  type ContractTerms,
} from "./maintenance";
import type { InvoiceLine } from "./schema";

const line: InvoiceLine = {
  id: "care",
  title: "Wartung",
  description: undefined,
  quantity: 1,
  unit: "Monat",
  unitPriceCents: 9_300,
  discountPercent: 0,
  vatRate: 20,
};

const terms = (patch: Partial<ContractTerms> = {}): ContractTerms => ({
  interval: "monthly",
  timing: "advance",
  startDate: "2026-10-15",
  endDate: null,
  billedUntil: null,
  ...patch,
});

describe("calendar periods", () => {
  it("aligns each interval to the calendar", () => {
    expect(calendarPeriod("monthly", "2026-02-10")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(calendarPeriod("quarterly", "2026-05-31")).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
    expect(calendarPeriod("halfyearly", "2026-07-01")).toEqual({
      from: "2026-07-01",
      to: "2026-12-31",
    });
    expect(calendarPeriod("yearly", "2028-02-29")).toEqual({
      from: "2028-01-01",
      to: "2028-12-31",
    });
  });

  it("clamps the day when adding months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-10-15", 12)).toBe("2027-10-15");
  });
});

describe("due periods", () => {
  it("prorates the first period and then bills full months in advance", () => {
    const first = nextPeriod(terms())!;
    expect(first).toMatchObject({ from: "2026-10-15", to: "2026-10-31", days: 17, periodDays: 31 });
    expect(first.full).toBe(false);
    const due = duePeriods(terms(), "2026-11-01");
    expect(due.map((period) => [period.from, period.to])).toEqual([
      ["2026-10-15", "2026-10-31"],
      ["2026-11-01", "2026-11-30"],
    ]);
    expect(due[1]!.full).toBe(true);
  });

  it("bills in arrears only after the period is over", () => {
    const arrears = terms({ timing: "arrears", startDate: "2026-10-01" });
    expect(duePeriods(arrears, "2026-10-31")).toEqual([]);
    expect(duePeriods(arrears, "2026-11-01").map((period) => period.to)).toEqual(["2026-10-31"]);
  });

  it("stops at the end date and prorates the last period", () => {
    const ending = terms({
      interval: "quarterly",
      startDate: "2026-01-01",
      billedUntil: "2026-03-31",
      endDate: "2026-05-15",
    });
    const due = duePeriods(ending, "2027-01-01");
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      from: "2026-04-01",
      to: "2026-05-15",
      days: 45,
      periodDays: 91,
    });
    expect(nextPeriod({ ...ending, billedUntil: "2026-05-15" })).toBeNull();
  });

  it("bills nothing while the start is open and caps a long gap", () => {
    expect(duePeriods(terms({ startDate: null }), "2030-01-01")).toEqual([]);
    expect(duePeriods(terms({ startDate: "2020-01-01" }), "2030-01-01", 12)).toHaveLength(12);
  });
});

describe("period lines", () => {
  it("keeps full periods and prorates partial ones by days", () => {
    const full = { from: "2026-11-01", to: "2026-11-30", days: 30, periodDays: 30, full: true };
    expect(periodLines([line], full)).toEqual([line]);
    const partial = { from: "2026-10-15", to: "2026-10-31", days: 17, periodDays: 31, full: false };
    const [prorated] = periodLines([line], partial);
    expect(prorated!.unitPriceCents).toBe(5_100);
    expect(prorated!.description).toBe("Anteilig: 17 von 31 Tagen");
  });

  it("compares lines for the automatic send", () => {
    expect(sameLines([line], [{ ...line }])).toBe(true);
    expect(sameLines([line], [{ ...line, unitPriceCents: 9_400 }])).toBe(false);
    expect(sameLines([line], [])).toBe(false);
  });
});

describe("notice", () => {
  it("ends at the month's end after the notice period, not before the minimum term", () => {
    const contract = { startDate: "2026-01-01", minimumMonths: 12, noticeMonths: 3 };
    expect(earliestEnd(contract, "2027-02-10")).toBe("2027-05-31");
    expect(earliestEnd(contract, "2026-03-01")).toBe("2026-12-31");
    expect(earliestEnd({ ...contract, minimumMonths: 0, noticeMonths: 0 }, "2026-03-10")).toBe(
      "2026-03-31",
    );
  });

  it("derives the state", () => {
    expect(contractState({ startDate: null, endDate: null }, "2026-10-01")).toBe("pending");
    expect(contractState({ startDate: "2026-01-01", endDate: null }, "2026-10-01")).toBe("active");
    expect(contractState({ startDate: "2026-01-01", endDate: "2026-12-31" }, "2026-10-01")).toBe(
      "ending",
    );
    expect(contractState({ startDate: "2026-01-01", endDate: "2026-09-30" }, "2026-10-01")).toBe(
      "ended",
    );
  });
});
