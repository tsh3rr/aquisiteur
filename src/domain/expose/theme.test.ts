import { describe, expect, it } from "vitest";
import { dark, light } from "@/design/tokens";
import { contrastRatio, hexToOklch, inSrgbGamut } from "@/lib/color";
import { deriveAccent, exposeThemeCss } from "./theme";

const samples = [
  "#ffeb3b", // pale yellow: far too light on white
  "#00ff00",
  "#7fb069",
  "#c2410c",
  "#1e3a8a", // dark navy: too dark on dark surfaces
  "#000000",
  "#ffffff",
  "#ff00ff",
  "#0ea5e9",
  "#8b5cf6",
];

describe("hexToOklch()", () => {
  it("converts reference colours", () => {
    expect(hexToOklch("#ffffff").l).toBeCloseTo(1, 3);
    expect(hexToOklch("#000000").l).toBeCloseTo(0, 3);
    const red = hexToOklch("#ff0000");
    expect(red.l).toBeCloseTo(0.628, 2);
    expect(red.c).toBeCloseTo(0.2577, 2);
    expect(red.h).toBeCloseTo(29.23, 0);
  });
});

describe("deriveAccent()", () => {
  it.each(samples)("keeps every pair at WCAG AA for %s", (hex) => {
    for (const [name, scheme] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      const accent = deriveAccent(hexToOklch(hex), name);
      for (const surface of [scheme.surface, scheme.background, scheme.surfaceSunken]) {
        expect(contrastRatio(accent.accent, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(accent.focusRing, surface)).toBeGreaterThanOrEqual(3);
      }
      expect(contrastRatio(accent.accentForeground, accent.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(accent.accentForeground, accent.accentHover)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(accent.accentSoftForeground, accent.accentSoft)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(inSrgbGamut(accent.accent)).toBe(true);
    }
  });

  it("keeps the hue of the brand colour", () => {
    const base = hexToOklch("#ffeb3b");
    expect(deriveAccent(base, "light").accent.h).toBeCloseTo(base.h, 0);
  });
});

describe("exposeThemeCss()", () => {
  it("emits light, dark or both schemes", () => {
    expect(exposeThemeCss({ appearance: "light" })).not.toContain("prefers-color-scheme");
    expect(exposeThemeCss({ appearance: "auto", accent: "#c2410c" })).toContain(
      "prefers-color-scheme:dark",
    );
    expect(exposeThemeCss({ appearance: "dark" })).toContain("color-scheme:dark");
  });
});
