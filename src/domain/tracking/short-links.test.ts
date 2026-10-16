import { describe, expect, it } from "vitest";
import {
  checkShortCode,
  editDistance,
  generateQrToken,
  generateShortCode,
  isQrTokenShape,
  normalizeShortCode,
  suggestShortCodes,
} from "./short-links";

describe("short links", () => {
  it("generates unguessable QR tokens and readable short codes", () => {
    const token = generateQrToken();
    expect(token).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(isQrTokenShape(token)).toBe(true);
    expect(generateShortCode()).toMatch(/^[2-9a-hjkmnp-z]{4}$/);
  });

  it("normalises what people type", () => {
    expect(normalizeShortCode("  Café Müller ")).toBe("cafe-mueller");
    expect(normalizeShortCode("K7M2.")).toBe("k7m2");
    expect(normalizeShortCode("cafe_mueller/")).toBe("cafe-mueller");
    expect(normalizeShortCode("Bäckerei  Groß")).toBe("baeckerei-gross");
  });

  it("rejects reserved and malformed custom codes", () => {
    expect(checkShortCode("cafe-mueller")).toBeNull();
    expect(checkShortCode("impressum")).toBe("reserved");
    expect(checkShortCode("ab")).toBe("invalid");
    expect(checkShortCode("-abc")).toBe("invalid");
  });

  it("measures typos including swapped letters", () => {
    expect(editDistance("k7m2", "k7m2")).toBe(0);
    expect(editDistance("k7m2", "k7n2")).toBe(1);
    expect(editDistance("k7m2", "7km2")).toBe(1);
    expect(editDistance("abc", "abcd")).toBe(1);
  });

  it("suggests near short codes, treating 0/o and 1/l/i alike", () => {
    const codes = ["k7m2", "cafe-mueller", "holzmann", "x9p4"];
    expect(suggestShortCodes("k7n2", codes)).toEqual(["k7m2"]);
    expect(suggestShortCodes("cafe-muller", codes)).toEqual(["cafe-mueller"]);
    expect(suggestShortCodes("h0lzmann", codes)).toEqual(["holzmann"]);
    expect(suggestShortCodes("zzzz", codes)).toEqual([]);
    expect(suggestShortCodes("k7", codes)).toEqual([]);
  });
});
