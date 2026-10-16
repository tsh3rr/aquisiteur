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
    candidate = {
      ...candidate,
      l: Math.min(1, Math.max(0, candidate.l + (darker ? -0.01 : 0.01))),
    };
    if (contrastRatio(candidate, bg) >= min) return candidate;
    if (candidate.l === 0 || candidate.l === 1) break;
  }
  return darker ? { l: 0, c: 0, h: 0 } : { l: 1, c: 0, h: 0 };
}

export function formatOklch({ l, c, h }: Oklch): string {
  const round = (value: number, digits: number) => Number(value.toFixed(digits));
  return `oklch(${round(l * 100, 1)}% ${round(c, 3)} ${round(h, 1)})`;
}

/** #rrggbb → OKLCH (Björn Ottosson's reference matrices). */
export function hexToOklch(hex: string): Oklch {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Invalid hex colour: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  const toLinear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear((value >> 16) & 0xff);
  const g = toLinear((value >> 8) & 0xff);
  const b = toLinear(value & 0xff);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const l = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.sqrt(a * a + bb * bb);
  const h = c < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

/** True when the colour is displayable in sRGB without clipping. */
export function inSrgbGamut({ l, c, h }: Oklch): boolean {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const eps = 1e-4;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ].every((channel) => channel >= -eps && channel <= 1 + eps);
}

/** Lowers chroma (keeping lightness and hue) until the colour fits sRGB. */
export function clampChroma(color: Oklch): Oklch {
  if (inSrgbGamut(color)) return color;
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut({ ...color, c: mid })) lo = mid;
    else hi = mid;
  }
  return { ...color, c: lo };
}
