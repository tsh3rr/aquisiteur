import { dark, light, type ColorScheme, type Oklch } from "@/design/tokens";
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

function fit(color: Oklch, backgrounds: Oklch[], min: number): Oklch {
  let candidate = clampChroma(color);
  for (let i = 0; i < 4; i++) {
    for (const bg of backgrounds) candidate = clampChroma(ensureContrast(candidate, bg, min));
    if (backgrounds.every((bg) => contrastRatio(candidate, bg) >= min)) return candidate;
  }
  return candidate;
}

export function deriveAccent(base: Oklch, scheme: "light" | "dark"): AccentFamily {
  const tokens = scheme === "light" ? light : dark;
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
}): string {
  const base = options.accent ? hexToOklch(options.accent) : null;
  const lightAccent = base ? deriveAccent(base, "light") : null;
  const darkAccent = base ? deriveAccent(base, "dark") : null;
  // Logos are designed for light backgrounds; in dark mode they sit on a light plate.
  const lightRule = `color-scheme:light;--expose-logo-plate:transparent;${declarations(light, lightAccent)}`;
  const darkRule = `color-scheme:dark;--expose-logo-plate:oklch(0.97 0.004 275);${declarations(dark, darkAccent)}`;
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
