import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Renders the cockpit app icons into public/icons/ from the same glyph as
 * src/app/icon.svg (the browser-tab favicon). Each target gets its own
 * artwork instead of a scaled copy: iOS masks the touch icon itself, so it is
 * full-bleed; Android badges are a white silhouette; small sizes get bolder
 * strokes. Run `pnpm icons:build` after changing the artwork and commit the
 * PNGs.
 */

const outDir = fileURLToPath(new URL("../public/icons/", import.meta.url));

const ACCENT_TOP = "#5c48e8";
const ACCENT_BOTTOM = "#4330c7";
const GLYPH = "M8 12.5 16 18l8-5.5M8 12v9.5h16V12M16 6.5v6M13.2 9 16 6.2 18.8 9";

/** The envelope-with-arrow glyph, centred on the 32×32 canvas. */
function glyph(scale: number, strokeWidth: number, color = "#fff") {
  return `<g transform="translate(16 16) scale(${scale}) translate(-16 -13.85)"><path d="${GLYPH}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

function background(radius: number) {
  return `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ACCENT_TOP}"/><stop offset="1" stop-color="${ACCENT_BOTTOM}"/></linearGradient></defs><rect width="32" height="32" rx="${radius}" fill="url(#bg)"/>`;
}

function svg(body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`;
}

const icons: { file: string; size: number; svg: string }[] = [
  // iOS home screen and, through it, iOS push notifications. No transparency:
  // iOS fills transparent pixels with black and rounds the corners itself.
  { file: "apple-touch-icon.png", size: 180, svg: svg(background(0) + glyph(1.2, 1.9)) },
  // Manifest "any": shown as-is (desktop install, Android without masking).
  { file: "icon-192.png", size: 192, svg: svg(background(7) + glyph(1.1, 2)) },
  { file: "icon-512.png", size: 512, svg: svg(background(7) + glyph(1.1, 1.8)) },
  // Manifest "maskable": full-bleed, glyph inside the 80 % safe circle.
  { file: "icon-maskable-512.png", size: 512, svg: svg(background(0) + glyph(1, 1.8)) },
  // Android status-bar badge: only the alpha channel counts, so a bold white
  // silhouette that still reads at 24 dp.
  { file: "badge-96.png", size: 96, svg: svg(glyph(1.5, 2.4)) },
];

mkdirSync(outDir, { recursive: true });
for (const icon of icons) {
  const target = `${outDir}${icon.file}`;
  await sharp(Buffer.from(icon.svg), { density: (72 * icon.size) / 32 })
    .resize(icon.size, icon.size)
    .png({ compressionLevel: 9, palette: false })
    .toFile(target);
  console.info(`Wrote ${target}`);
}
