import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath()", () => {
  it("keeps cockpit paths", () => {
    expect(safeNextPath("/kunden/abc?tab=chat")).toBe("/kunden/abc?tab=chat");
    expect(safeNextPath(undefined)).toBe("/");
  });

  it("refuses targets on other hosts", () => {
    for (const next of [
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "/\t/evil.example",
      "https://evil.example",
      "javascript:alert(1)",
    ]) {
      expect(safeNextPath(next)).toBe("/");
    }
  });
});
