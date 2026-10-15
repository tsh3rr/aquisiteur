/**
 * OKLCH → sRGB conversion and WCAG 2.x contrast. Used to verify design
 * tokens and (phase 1) to auto-correct exposé accent colours (§7.2).
 */
import type { Oklch } from "@/design/tokens";

export type Rgb = { r: number; g: number; b: number };

/** Returns linear-light sRGB, clamped to gamut. */
export function oklchToLinearSrgb({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    r: clamp(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    g: clamp(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    b: clamp(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  };
}

export function relativeLuminance(color: Oklch): number {
  const { r, g, b } = oklchToLinearSrgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Moves `fg`'s lightness away from `bg` until the ratio reaches `min`.
 * Keeps hue and chroma so a brand colour stays recognisable.
 */
export function ensureContrast(fg: Oklch, bg: Oklch, min = 4.5): Oklch {
  if (contrastRatio(fg, bg) >= min) return fg;
  const darker = relativeLuminance(bg) > 0.18;
  let candidate = { ...fg };
  for (let i = 0; i < 100; i++) {
    candidate = { ...candidate, l: Math.min(1, Math.max(0, candidate.l + (darker ? -0.01 : 0.01))) };
    if (contrastRatio(candidate, bg) >= min) return candidate;
    if (candidate.l === 0 || candidate.l === 1) break;
  }
  return darker ? { l: 0, c: 0, h: 0 } : { l: 1, c: 0, h: 0 };
}

export function formatOklch({ l, c, h }: Oklch): string {
  const round = (value: number, digits: number) => Number(value.toFixed(digits));
  return `oklch(${round(l * 100, 1)}% ${round(c, 3)} ${round(h, 1)})`;
}
