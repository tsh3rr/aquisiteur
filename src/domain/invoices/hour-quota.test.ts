import { describe, expect, it } from "vitest";
import {
  formatHours,
  includedForSpan,
  overageLine,
  overageMinutes,
  overagePeriod,
  parseDuration,
  usedMinutes,
} from "./hour-quota";

describe("durations", () => {
  it("parses the usual spellings", () => {
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration("1.25")).toBe(75);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("45min")).toBe(45);
    expect(parseDuration("2 h")).toBe(120);
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("0:00")).toBeNull();
    expect(parseDuration("viel")).toBeNull();
    expect(formatHours(90)).toBe("1,5 Std.");
  });

  it("rounds the overage up to a quarter hour", () => {
    const entries = [{ minutes: 100 }, { minutes: 45 }];
    expect(usedMinutes(entries)).toBe(145);
    expect(overageMinutes(entries, 120)).toBe(30);
    expect(overageMinutes(entries, 150)).toBe(0);
  });
});

describe("overagePeriod", () => {
  const advance = { interval: "monthly", timing: "advance", startDate: "2026-09-15" } as const;

  it("bills the previous period in advance and the same in arrears", () => {
    expect(overagePeriod(advance, { from: "2026-09-15", to: "2026-09-30" }, null)).toBeNull();
    expect(overagePeriod(advance, { from: "2026-10-01", to: "2026-10-31" }, null)).toEqual({
      from: "2026-09-15",
      to: "2026-09-30",
    });
    expect(
      overagePeriod(
        { ...advance, timing: "arrears" },
        { from: "2026-10-01", to: "2026-10-31" },
        "2026-09-30",
      ),
    ).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("never bills a day twice", () => {
    expect(
      overagePeriod(advance, { from: "2026-10-01", to: "2026-10-31" }, "2026-09-30"),
    ).toBeNull();
  });
});

describe("overageLine", () => {
  it("lists the work and charges the hourly rate", () => {
    const line = overageLine({
      entries: [
        { workDate: "2026-10-20", minutes: 90, description: "Neue Unterseite" },
        { workDate: "2026-10-02", minutes: 60, description: "Plugin-Update" },
      ],
      includedMinutes: 60,
      hourlyRateCents: 8_500,
      span: { from: "2026-10-01", to: "2026-10-31" },
      vatRate: 20,
    });
    expect(line).toMatchObject({ quantity: 1.5, unitPriceCents: 8_500, unit: "Std." });
    expect(line!.description!.split("\n").slice(1)).toEqual([
      "02.10.2026 1 Std. Plugin-Update",
      "20.10.2026 1,5 Std. Neue Unterseite",
    ]);
    expect(
      overageLine({
        entries: [{ workDate: "2026-10-02", minutes: 30, description: "x" }],
        includedMinutes: 60,
        hourlyRateCents: 8_500,
        span: { from: "2026-10-01", to: "2026-10-31" },
        vatRate: 20,
      }),
    ).toBeNull();
  });
});

describe("includedForSpan", () => {
  it("prorates a partial period by days", () => {
    expect(includedForSpan("monthly", { from: "2026-10-01", to: "2026-10-31" }, 120)).toBe(120);
    expect(includedForSpan("monthly", { from: "2026-09-16", to: "2026-09-30" }, 120)).toBe(60);
  });
});
