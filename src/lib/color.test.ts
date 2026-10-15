import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderTokensCss } from "@/design/render-css";
import { contrastPairs, dark, light } from "@/design/tokens";
import { contrastRatio, ensureContrast, oklchToLinearSrgb } from "./color";

describe("OKLCH conversion", () => {
  it("maps white and black correctly", () => {
    expect(oklchToLinearSrgb({ l: 1, c: 0, h: 0 })).toEqual({
      r: expect.closeTo(1, 3),
      g: expect.closeTo(1, 3),
      b: expect.closeTo(1, 3),
    });
    expect(contrastRatio({ l: 1, c: 0, h: 0 }, { l: 0, c: 0, h: 0 })).toBeCloseTo(21, 0);
  });
});

describe("ensureContrast()", () => {
  it("darkens a light accent on white until it passes AA", () => {
    const white = { l: 1, c: 0, h: 0 };
    const pale = { l: 0.85, c: 0.1, h: 90 };
    const fixed = ensureContrast(pale, white, 4.5);
    expect(contrastRatio(fixed, white)).toBeGreaterThanOrEqual(4.5);
    expect(fixed.h).toBe(90);
  });

  it("lightens on dark backgrounds and leaves passing colours alone", () => {
    const black = { l: 0.15, c: 0, h: 0 };
    const fixed = ensureContrast({ l: 0.3, c: 0.1, h: 250 }, black, 4.5);
    expect(contrastRatio(fixed, black)).toBeGreaterThanOrEqual(4.5);
    const ok = { l: 0.2, c: 0, h: 0 };
    expect(ensureContrast(ok, { l: 1, c: 0, h: 0 })).toBe(ok);
  });
});

describe("design tokens", () => {
  it.each(contrastPairs.map((pair) => [`${pair.fg} on ${pair.bg}`, pair] as const))(
    "%s meets WCAG AA in light and dark",
    (_label, { fg, bg, min }) => {
      expect(contrastRatio(light[fg], light[bg])).toBeGreaterThanOrEqual(min);
      expect(contrastRatio(dark[fg], dark[bg])).toBeGreaterThanOrEqual(min);
    },
  );

  it("generated tokens.css is up to date (run `pnpm tokens:build`)", () => {
    const onDisk = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
    expect(onDisk).toBe(renderTokensCss());
  });
});
