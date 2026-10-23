import { Font } from "@react-pdf/renderer";
import type { Styles } from "@react-pdf/renderer";
import type { ExposeStyle } from "@/domain/expose/schema";

/**
 * Fonts of the printed pages (letter, teaser, exposé PDF), registered once.
 * React-PDF reads WOFF, not WOFF2; the files live in public/fonts/letter/.
 * The browser fetches them by URL; the server (invoices sent by the hourly
 * job, ADR-0073) reads them from disk.
 */
const base =
  typeof window === "undefined" ? `${process.cwd()}/public/fonts/letter` : "/fonts/letter";

Font.register({
  family: "Geist",
  fonts: [
    { src: `${base}/geist-latin-400-normal.woff`, fontWeight: 400 },
    { src: `${base}/geist-latin-600-normal.woff`, fontWeight: 600 },
  ],
});
// Words are never split with hyphens the reader would not expect.
Font.registerHyphenationCallback((word) => [word]);

// Headline faces of the exposé styles.
Font.register({ family: "AqSerif", src: `${base}/instrument-serif-latin-400-normal.woff` });
Font.register({ family: "AqAnton", src: `${base}/anton-latin-400-normal.woff` });
Font.register({
  family: "AqNunito",
  src: `${base}/nunito-latin-800-normal.woff`,
  fontWeight: 800,
});

const DISPLAY: Record<ExposeStyle, Styles[string]> = {
  editorial: { fontFamily: "AqSerif", fontWeight: 400, lineHeight: 1.05 },
  bold: { fontFamily: "AqAnton", fontWeight: 400, lineHeight: 1.05, textTransform: "uppercase" },
  soft: { fontFamily: "AqNunito", fontWeight: 800, lineHeight: 1.12 },
};

/** Headline style of the exposé, for the subject line on page 1 too. */
export const displayStyle = (style: ExposeStyle) => DISPLAY[style];
