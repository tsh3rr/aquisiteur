import localFont from "next/font/local";

/** Display face for exposé headlines (§8), self-hosted, latin subset (~21 KB). */
export const displayFont = localFont({
  src: "../../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
  variable: "--aq-font-display",
  display: "swap",
  weight: "400",
  fallback: ["Georgia", "Times New Roman", "serif"],
});
