import { dark, light, type ColorScheme, type Oklch } from "@/design/tokens";
import type { ExposeStyle } from "@/domain/expose/schema";
import { clampChroma, contrastRatio, ensureContrast, formatOklch, hexToOklch } from "@/lib/color";

/**
 * Per-exposé theming (§7.2): the prospect's accent colour replaces the
 * accent family of the design tokens. Every derived colour is corrected to
 * WCAG AA against the surfaces it is used on, in light and dark mode, so an
 * author can pass any brand colour without breaking contrast.
 */

type AccentFamily = Pick<
  ColorScheme,
  | "accent"
  | "accentHover"
  | "accentForeground"
  | "accentSoft"
  | "accentSoftForeground"
  | "focusRing"
>;

const WHITE: Oklch = { l: 0.995, c: 0, h: 0 };
const ok = (l: number, c: number, h: number): Oklch => ({ l, c, h });

type Neutrals = Pick<
  ColorScheme,
  | "background"
  | "surface"
  | "surfaceRaised"
  | "surfaceSunken"
  | "foreground"
  | "foregroundMuted"
  | "foregroundSubtle"
  | "border"
  | "borderStrong"
>;

/**
 * Neutral palettes of the exposé styles. "editorial" keeps the design
 * tokens; "bold" is pure ink on paper (no hue, lines as strong as text);
 * "soft" is warm cream with a green-grey ink. Shapes, shadows and type of
 * each style live in globals.css under [data-expose-style].
 */
const styleNeutrals: Record<
  Exclude<ExposeStyle, "editorial">,
  Record<"light" | "dark", Neutrals>
> = {
  bold: {
    light: {
      background: ok(0.975, 0, 0),
      surface: ok(1, 0, 0),
      surfaceRaised: ok(1, 0, 0),
      surfaceSunken: ok(0.935, 0, 0),
      foreground: ok(0.14, 0, 0),
      foregroundMuted: ok(0.36, 0, 0),
      foregroundSubtle: ok(0.44, 0, 0),
      border: ok(0.14, 0, 0),
      borderStrong: ok(0.14, 0, 0),
    },
    dark: {
      background: ok(0.12, 0, 0),
      surface: ok(0.165, 0, 0),
      surfaceRaised: ok(0.2, 0, 0),
      surfaceSunken: ok(0.09, 0, 0),
      foreground: ok(0.97, 0, 0),
      foregroundMuted: ok(0.8, 0, 0),
      foregroundSubtle: ok(0.72, 0, 0),
      border: ok(0.9, 0, 0),
      borderStrong: ok(0.9, 0, 0),
    },
  },
  soft: {
    light: {
      background: ok(0.972, 0.014, 85),
      surface: ok(0.993, 0.006, 85),
      surfaceRaised: ok(0.993, 0.006, 85),
      surfaceSunken: ok(0.945, 0.02, 85),
      foreground: ok(0.27, 0.03, 165),
      foregroundMuted: ok(0.44, 0.025, 165),
      foregroundSubtle: ok(0.5, 0.022, 165),
      border: ok(0.9, 0.018, 85),
      borderStrong: ok(0.57, 0.025, 165),
    },
    dark: {
      background: ok(0.2, 0.016, 165),
      surface: ok(0.235, 0.018, 165),
      surfaceRaised: ok(0.27, 0.02, 165),
      surfaceSunken: ok(0.175, 0.014, 165),
      foreground: ok(0.95, 0.012, 85),
      foregroundMuted: ok(0.79, 0.016, 85),
      foregroundSubtle: ok(0.73, 0.016, 85),
      border: ok(0.34, 0.02, 165),
      borderStrong: ok(0.63, 0.022, 165),
    },
  },
};

/** The full colour scheme of a style before the prospect's accent is applied. */
export function styleScheme(style: ExposeStyle, scheme: "light" | "dark"): ColorScheme {
  const tokens = scheme === "light" ? light : dark;
  return style === "editorial" ? tokens : { ...tokens, ...styleNeutrals[style][scheme] };
}

function fit(color: Oklch, backgrounds: Oklch[], min: number): Oklch {
  let candidate = clampChroma(color);
  for (let i = 0; i < 4; i++) {
    for (const bg of backgrounds) candidate = clampChroma(ensureContrast(candidate, bg, min));
    if (backgrounds.every((bg) => contrastRatio(candidate, bg) >= min)) return candidate;
  }
  return candidate;
}

export function deriveAccent(
  base: Oklch,
  scheme: "light" | "dark",
  style: ExposeStyle = "editorial",
): AccentFamily {
  const tokens = styleScheme(style, scheme);
  const surfaces = [tokens.surface, tokens.background, tokens.surfaceSunken];
  // Used as link/text colour on surfaces and as button fill under on-accent text.
  const accent = fit(base, surfaces, 4.5);
  const step = scheme === "light" ? -0.06 : 0.06;
  const accentHover = fit({ ...accent, l: accent.l + step }, surfaces, 4.5);
  const onAccentCandidate =
    scheme === "light" ? WHITE : { l: 0.17, c: Math.min(accent.c, 0.04), h: accent.h };
  const accentForeground = fit(onAccentCandidate, [accent, accentHover], 4.5);
  const accentSoft = clampChroma(
    scheme === "light"
      ? { l: 0.955, c: Math.min(accent.c, 0.035), h: accent.h }
      : { l: 0.27, c: Math.min(accent.c, 0.06), h: accent.h },
  );
  const accentSoftForeground = fit(accent, [accentSoft], 4.5);
  return {
    accent,
    accentHover,
    accentForeground,
    accentSoft,
    accentSoftForeground,
    focusRing: fit(accent, surfaces, 3),
  };
}

const kebab = (value: string) => value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

function declarations(scheme: ColorScheme, accent: AccentFamily | null): string {
  return Object.entries({ ...scheme, ...accent })
    .map(([name, value]) => `--aq-${kebab(name)}:${formatOklch(value)};`)
    .join("");
}

/**
 * CSS for `[data-expose-theme]`. The wrapper redefines the whole colour
 * scheme so the exposé never inherits a cockpit theme cookie.
 */
export function exposeThemeCss(options: {
  accent?: string | undefined;
  appearance: "auto" | "light" | "dark";
  style?: ExposeStyle;
}): string {
  const style = options.style ?? "editorial";
  const base = options.accent ? hexToOklch(options.accent) : null;
  const lightAccent = base ? deriveAccent(base, "light", style) : null;
  const darkAccent = base ? deriveAccent(base, "dark", style) : null;
  // Logos are designed for light backgrounds; in dark mode they sit on a light plate.
  // Without a visible plate its padding hangs left so the logo itself meets the text edge.
  const lightRule = `color-scheme:light;--expose-logo-plate:transparent;--expose-logo-inset:-0.375rem;${declarations(styleScheme(style, "light"), lightAccent)}`;
  const darkRule = `color-scheme:dark;--expose-logo-plate:oklch(0.97 0.004 275);--expose-logo-inset:0;${declarations(styleScheme(style, "dark"), darkAccent)}`;
  const selector = "[data-expose-theme]";
  switch (options.appearance) {
    case "light":
      return `${selector}{${lightRule}}`;
    case "dark":
      return `${selector}{${darkRule}}`;
    default:
      return `${selector}{${lightRule}}@media (prefers-color-scheme:dark){${selector}{${darkRule}}}`;
  }
}
