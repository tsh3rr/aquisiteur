import { describe, expect, it } from "vitest";
import { buildFunnel, reachedStage } from "./funnel";
import { formatHours, formatPercent, formatSeconds } from "./format";
import { parsePeriod, periodDays, previousPeriod, trend } from "./period";

describe("periods", () => {
  const now = new Date("2026-10-16T09:00:00Z");

  it("defaults to the last 30 whole days including today", () => {
    const { period, preset } = parsePeriod({}, now);
    expect(preset).toBe("30d");
    expect(period.to.toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(period.from.toISOString()).toBe("2026-09-17T00:00:00.000Z");
    expect(periodDays(period)).toHaveLength(30);
  });

  it("reads a custom range and the period before it", () => {
    const { period } = parsePeriod({ von: "2026-10-01", bis: "2026-10-07" }, now);
    expect(periodDays(period)).toHaveLength(7);
    expect(previousPeriod(period).from.toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("ignores broken ranges", () => {
    expect(parsePeriod({ von: "2026-10-07", bis: "2026-10-01" }, now).preset).toBe("30d");
  });

  it("describes the trend", () => {
    expect(trend(12, 10)?.text).toBe("+20 % ggü. Vorperiode");
    expect(trend(0.3, 0.25, true)?.text).toBe("+5 Pp. ggü. Vorperiode");
    expect(trend(3, 0)?.text).toBe("neu in diesem Zeitraum");
    expect(trend(null, 2)).toBeNull();
  });
});

describe("funnel", () => {
  it("counts every stage a prospect reached, also when lost later", () => {
    expect(
      reachedStage({ opened: true, read: false, attempt: false, statuses: ["lost", "meeting"] }),
    ).toBe("meeting");
    const funnel = buildFunnel([
      { opened: false, read: false, attempt: false, statuses: ["letter_sent"] },
      { opened: true, read: true, attempt: false, statuses: ["opened"] },
      { opened: true, read: true, attempt: true, statuses: ["won"] },
      { opened: true, read: false, attempt: false, statuses: ["opened"] },
    ]);
    expect(funnel.map((row) => row.count)).toEqual([4, 3, 2, 1, 1, 1, 1]);
    expect(funnel[1]!.rate).toBe(0.75);
    expect(funnel[2]!.dropOff).toBeCloseTo(1 / 3);
    expect(funnel[0]!.dropOff).toBeNull();
  });
});

describe("format", () => {
  it("formats German numbers", () => {
    expect(formatPercent(0.425)).toBe("43 %");
    expect(formatHours(30)).toBe("30 Std.");
    expect(formatHours(84)).toBe("3,5 Tage");
    expect(formatSeconds(105)).toBe("1:45 Min.");
  });
});
