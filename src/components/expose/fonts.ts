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

/**
 * Headline faces of the other styles, served from public/fonts/expose and
 * declared in globals.css. The exposé preloads only the face of its own
 * style; next/font would preload every face on every exposé, and a face
 * that arrives after the first paint shifts the layout (ADR-0050).
 */
export const styleFontHref: Record<ExposeStyle, string | null> = {
  editorial: null,
  bold: "/fonts/expose/anton-latin-400-normal.woff2",
  soft: "/fonts/expose/nunito-latin-800-normal.woff2",
};
