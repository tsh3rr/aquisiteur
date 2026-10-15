/**
 * Design tokens: the single source of truth. `pnpm tokens:build` turns this
 * file into src/styles/tokens.css; a unit test fails when the CSS is stale
 * or when a text/background pair drops below WCAG AA.
 *
 * Colours are OKLCH. Neutrals carry a faint blue-violet hue so the UI feels
 * cool and calm; the accent is a saturated electric indigo used sparingly.
 */

export type Oklch = { l: number; c: number; h: number };
const ok = (l: number, c: number, h: number): Oklch => ({ l, c, h });

export interface ColorScheme {
  background: Oklch;
  surface: Oklch;
  surfaceRaised: Oklch;
  surfaceSunken: Oklch;
  foreground: Oklch;
  foregroundMuted: Oklch;
  foregroundSubtle: Oklch;
  border: Oklch;
  borderStrong: Oklch;
  accent: Oklch;
  accentHover: Oklch;
  accentForeground: Oklch;
  accentSoft: Oklch;
  accentSoftForeground: Oklch;
  focusRing: Oklch;
  success: Oklch;
  successSoft: Oklch;
  successForeground: Oklch;
  warning: Oklch;
  warningSoft: Oklch;
  warningForeground: Oklch;
  danger: Oklch;
  dangerHover: Oklch;
  dangerForeground: Oklch;
  dangerSoft: Oklch;
  dangerSoftForeground: Oklch;
}

export const light: ColorScheme = {
  background: ok(0.985, 0.004, 275),
  surface: ok(1, 0, 0),
  surfaceRaised: ok(1, 0, 0),
  surfaceSunken: ok(0.962, 0.006, 275),
  foreground: ok(0.2, 0.02, 275),
  foregroundMuted: ok(0.44, 0.02, 275),
  foregroundSubtle: ok(0.53, 0.018, 275),
  border: ok(0.9, 0.008, 275),
  borderStrong: ok(0.56, 0.015, 275),
  accent: ok(0.5, 0.24, 275),
  accentHover: ok(0.44, 0.23, 275),
  accentForeground: ok(0.99, 0.005, 275),
  accentSoft: ok(0.95, 0.03, 275),
  accentSoftForeground: ok(0.42, 0.2, 275),
  focusRing: ok(0.55, 0.24, 275),
  success: ok(0.5, 0.13, 155),
  successSoft: ok(0.95, 0.04, 155),
  successForeground: ok(0.38, 0.1, 155),
  warning: ok(0.58, 0.14, 65),
  warningSoft: ok(0.96, 0.045, 80),
  warningForeground: ok(0.43, 0.1, 55),
  danger: ok(0.52, 0.2, 25),
  dangerHover: ok(0.46, 0.19, 25),
  dangerForeground: ok(0.99, 0.005, 25),
  dangerSoft: ok(0.95, 0.03, 25),
  dangerSoftForeground: ok(0.44, 0.17, 25),
};

export const dark: ColorScheme = {
  background: ok(0.16, 0.012, 275),
  surface: ok(0.195, 0.014, 275),
  surfaceRaised: ok(0.235, 0.016, 275),
  surfaceSunken: ok(0.135, 0.01, 275),
  foreground: ok(0.96, 0.006, 275),
  foregroundMuted: ok(0.77, 0.014, 275),
  foregroundSubtle: ok(0.7, 0.014, 275),
  border: ok(0.3, 0.016, 275),
  borderStrong: ok(0.6, 0.018, 275),
  accent: ok(0.72, 0.16, 275),
  accentHover: ok(0.78, 0.13, 275),
  accentForeground: ok(0.18, 0.04, 275),
  accentSoft: ok(0.28, 0.06, 275),
  accentSoftForeground: ok(0.86, 0.08, 275),
  focusRing: ok(0.75, 0.16, 275),
  success: ok(0.74, 0.14, 155),
  successSoft: ok(0.27, 0.04, 155),
  successForeground: ok(0.84, 0.12, 155),
  warning: ok(0.8, 0.14, 75),
  warningSoft: ok(0.28, 0.04, 75),
  warningForeground: ok(0.86, 0.12, 80),
  danger: ok(0.7, 0.17, 25),
  dangerHover: ok(0.76, 0.14, 25),
  dangerForeground: ok(0.17, 0.03, 25),
  dangerSoft: ok(0.28, 0.06, 25),
  dangerSoftForeground: ok(0.86, 0.08, 25),
};

/**
 * Text/background pairs the UI actually uses. Each must reach the given
 * contrast ratio in both schemes (4.5:1 text, 3:1 UI components, §8).
 */
export const contrastPairs: ReadonlyArray<{
  fg: keyof ColorScheme;
  bg: keyof ColorScheme;
  min: number;
}> = [
  { fg: "foreground", bg: "background", min: 4.5 },
  { fg: "foreground", bg: "surface", min: 4.5 },
  { fg: "foreground", bg: "surfaceSunken", min: 4.5 },
  { fg: "foregroundMuted", bg: "background", min: 4.5 },
  { fg: "foregroundMuted", bg: "surface", min: 4.5 },
  { fg: "foregroundMuted", bg: "surfaceSunken", min: 4.5 },
  { fg: "foregroundSubtle", bg: "surface", min: 4.5 },
  { fg: "foregroundSubtle", bg: "background", min: 4.5 },
  { fg: "accentForeground", bg: "accent", min: 4.5 },
  { fg: "accentForeground", bg: "accentHover", min: 4.5 },
  { fg: "accent", bg: "surface", min: 4.5 },
  { fg: "accent", bg: "background", min: 4.5 },
  { fg: "accentSoftForeground", bg: "accentSoft", min: 4.5 },
  { fg: "successForeground", bg: "successSoft", min: 4.5 },
  { fg: "warningForeground", bg: "warningSoft", min: 4.5 },
  { fg: "dangerForeground", bg: "danger", min: 4.5 },
  { fg: "dangerForeground", bg: "dangerHover", min: 4.5 },
  { fg: "dangerSoftForeground", bg: "dangerSoft", min: 4.5 },
  { fg: "danger", bg: "surface", min: 4.5 },
  { fg: "borderStrong", bg: "surface", min: 3 },
  { fg: "focusRing", bg: "background", min: 3 },
  { fg: "focusRing", bg: "surface", min: 3 },
  { fg: "success", bg: "surface", min: 3 },
  { fg: "warning", bg: "surface", min: 3 },
];

export const radius = { sm: "0.375rem", md: "0.625rem", lg: "0.875rem", xl: "1.25rem", full: "9999px" };

export const shadow = {
  sm: "0 1px 2px oklch(0.2 0.02 275 / 0.06)",
  md: "0 1px 2px oklch(0.2 0.02 275 / 0.05), 0 4px 12px -2px oklch(0.2 0.02 275 / 0.08)",
  lg: "0 2px 4px oklch(0.2 0.02 275 / 0.05), 0 16px 40px -8px oklch(0.2 0.02 275 / 0.16)",
};

export const motion = {
  durationFast: "120ms",
  durationBase: "200ms",
  durationSlow: "360ms",
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
};

/** Fluid type scale (clamp from 360px to 1280px viewport). */
export const fontSize = {
  xs: "clamp(0.75rem, 0.73rem + 0.08vw, 0.8rem)",
  sm: "clamp(0.875rem, 0.85rem + 0.1vw, 0.925rem)",
  base: "clamp(1rem, 0.97rem + 0.12vw, 1.0625rem)",
  lg: "clamp(1.125rem, 1.08rem + 0.2vw, 1.25rem)",
  xl: "clamp(1.25rem, 1.18rem + 0.35vw, 1.5rem)",
  "2xl": "clamp(1.5rem, 1.37rem + 0.6vw, 1.95rem)",
  "3xl": "clamp(1.875rem, 1.65rem + 1vw, 2.5rem)",
  "4xl": "clamp(2.25rem, 1.9rem + 1.6vw, 3.4rem)",
};
