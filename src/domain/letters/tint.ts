/**
 * The agency logo in the middle of the letter's QR code (§7.9), recoloured
 * to one colour on the accent badge. Works on raw RGBA pixels so the
 * browser canvas only has to draw and read them back.
 */

/** Wider than this, a logo is a wordmark too thin to read in a 5 mm badge. */
export const MAX_BADGE_LOGO_RATIO = 2.2;

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * How much of each pixel is logo, 0 to 1. A logo with transparency is its
 * alpha; an opaque one (a JPEG on white) is its darkness, so the white
 * background drops out.
 */
export function logoCoverage(data: Uint8ClampedArray): Float32Array {
  const pixels = data.length / 4;
  let transparent = 0;
  for (let i = 0; i < pixels; i++) if (data[i * 4 + 3]! < 128) transparent++;
  const useAlpha = transparent > pixels * 0.02;
  const coverage = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const alpha = data[i * 4 + 3]! / 255;
    if (useAlpha) {
      coverage[i] = alpha;
      continue;
    }
    const luminance =
      (0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!) / 255;
    // Light greys still count as background, so JPEG noise around the mark stays clean.
    coverage[i] = alpha * Math.min(1, Math.max(0, (0.92 - luminance) / 0.8));
  }
  return coverage;
}

/** Repaints the pixels in place: `background` where there is no logo, `ink` where there is. */
export function tintLogo(data: Uint8ClampedArray, background: string, ink: string): void {
  const coverage = logoCoverage(data);
  const bg = rgb(background);
  const fg = rgb(ink);
  for (let i = 0; i < coverage.length; i++) {
    const t = coverage[i]!;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(bg[c]! + (fg[c]! - bg[c]!) * t);
    data[i * 4 + 3] = 255;
  }
}
