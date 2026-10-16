import { describe, expect, it } from "vitest";
import { entitlements, withinLimit } from "./entitlements";

describe("entitlements()", () => {
  it("gives every v1 workspace the unlimited plan", () => {
    const result = entitlements({ id: "w" });
    expect(result.plan).toBe("unlimited");
    expect(Object.values(result.limits).every((limit) => limit === null)).toBe(true);
    expect(Object.values(result.features).every(Boolean)).toBe(true);
  });

  it("withinLimit treats null as unlimited", () => {
    expect(withinLimit(null, 10_000)).toBe(true);
    expect(withinLimit(3, 2)).toBe(true);
    expect(withinLimit(3, 3)).toBe(false);
    expect(withinLimit(3, 1, 2)).toBe(true);
  });
});
