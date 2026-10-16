import { describe, expect, it } from "vitest";
import { formatRelative } from "./relative-time";

describe("formatRelative", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it("speaks German", () => {
    expect(formatRelative(ago(10), now)).toBe("gerade eben");
    expect(formatRelative(ago(5 * 60), now)).toBe("vor 5 Minuten");
    expect(formatRelative(ago(3 * 3600), now)).toBe("vor 3 Stunden");
    expect(formatRelative(ago(86_400), now)).toBe("gestern");
    expect(formatRelative(ago(30 * 86_400), now)).toBe("15.09.2026");
  });
});
