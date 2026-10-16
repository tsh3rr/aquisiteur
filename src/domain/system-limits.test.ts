import { describe, expect, it } from "vitest";
import { formatBytes, PLATFORM_LIMITS, usageReading } from "./system-limits";

describe("usageReading", () => {
  it("warns from 80 % and flags an exceeded limit", () => {
    expect(usageReading(10, 100).level).toBe("ok");
    expect(usageReading(80, 100).level).toBe("warning");
    expect(usageReading(100, 100).level).toBe("exceeded");
    expect(usageReading(5, 100).ratio).toBeCloseTo(0.05);
  });

  it("treats a missing limit as unlimited", () => {
    expect(usageReading(1_000_000, null)).toEqual({
      used: 1_000_000,
      limit: null,
      ratio: null,
      level: "unlimited",
    });
  });

  it("knows the free plan's quotas", () => {
    expect(PLATFORM_LIMITS.free.requestsPerDay).toBe(100_000);
    expect(PLATFORM_LIMITS.free.cpuMsPerRequest).toBe(10);
  });
});

describe("formatBytes", () => {
  it("uses German decimals and binary units", () => {
    expect(formatBytes(512)).toBe("512 Byte");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(500 * 1024 * 1024)).toBe("500 MB");
  });
});
