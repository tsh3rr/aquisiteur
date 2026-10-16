import localFont from "next/font/local";
import type { ExposeStyle } from "@/domain/expose/schema";

/** Display face for exposé headlines (§8), self-hosted, latin subset (~21 KB). */
export const displayFont = localFont({
  src: "../../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
  variable: "--aq-font-display",
  display: "swap",
  weight: "400",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

/** Heavy condensed face of the "bold" style (~19 KB). */
const boldFont = localFont({
  src: "../../../node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2",
  variable: "--aq-font-display",
  display: "swap",
  weight: "400",
  preload: false,
  fallback: ["Impact", "Arial Narrow", "sans-serif"],
});

/** Rounded variable sans of the "soft" style (~39 KB, headlines and body). */
const softFont = localFont({
  src: "../../../node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2",
  variable: "--aq-font-display",
  display: "swap",
  weight: "200 1000",
  preload: false,
  fallback: ["ui-rounded", "system-ui", "sans-serif"],
});

/** Class that sets --aq-font-display for the exposé's style. */
export function displayFontClass(style: ExposeStyle): string {
  switch (style) {
    case "bold":
      return boldFont.variable;
    case "soft":
      return softFont.variable;
    default:
      return displayFont.variable;
  }
}
