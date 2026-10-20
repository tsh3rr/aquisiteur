import { Font } from "@react-pdf/renderer";
import type { Styles } from "@react-pdf/renderer";
import type { ExposeStyle } from "@/domain/expose/schema";

/**
 * Fonts of the printed pages (letter, teaser, exposé PDF), registered once.
 * React-PDF reads WOFF, not WOFF2; the files live in public/fonts/letter/.
 */

Font.register({
  family: "Geist",
  fonts: [
    { src: "/fonts/letter/geist-latin-400-normal.woff", fontWeight: 400 },
    { src: "/fonts/letter/geist-latin-600-normal.woff", fontWeight: 600 },
  ],
});
// Words are never split with hyphens the reader would not expect.
Font.registerHyphenationCallback((word) => [word]);

// Headline faces of the exposé styles.
Font.register({ family: "AqSerif", src: "/fonts/letter/instrument-serif-latin-400-normal.woff" });
Font.register({ family: "AqAnton", src: "/fonts/letter/anton-latin-400-normal.woff" });
Font.register({
  family: "AqNunito",
  src: "/fonts/letter/nunito-latin-800-normal.woff",
  fontWeight: 800,
});

const DISPLAY: Record<ExposeStyle, Styles[string]> = {
  editorial: { fontFamily: "AqSerif", fontWeight: 400, lineHeight: 1.05 },
  bold: { fontFamily: "AqAnton", fontWeight: 400, lineHeight: 1.05, textTransform: "uppercase" },
  soft: { fontFamily: "AqNunito", fontWeight: 800, lineHeight: 1.12 },
};

/** Headline style of the exposé, for the subject line on page 1 too. */
export const displayStyle = (style: ExposeStyle) => DISPLAY[style];
