import { MAX_BADGE_LOGO_RATIO, tintLogo } from "@/domain/letters/tint";

/**
 * React-PDF only embeds PNG and JPEG, exposé images are WebP. The browser
 * decodes them anyway, so a canvas turns each into a JPEG data URL once.
 * JPEG on white also for logos and the signature: every image sits on white
 * paper, and React-PDF inflates PNGs in a blob worker, which the CSP blocks
 * (`worker-src 'self'`), so a PNG would never finish. A picture that fails
 * to load is left out rather than failing the PDF.
 */
export async function printableImage(src: string) {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch {
    return null;
  }
}

/**
 * The agency logo for the middle of the QR code: one colour on the accent,
 * as a square JPEG (see above why not PNG). Null for a wordmark too wide to
 * read at badge size, or when it fails to load; the badge is then a plain dot.
 */
export async function badgeLogo(src: string, background: string, ink: string) {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const ratio = Math.max(bitmap.width / bitmap.height, bitmap.height / bitmap.width);
    if (ratio > MAX_BADGE_LOGO_RATIO) {
      bitmap.close();
      return null;
    }
    const side = 256;
    const scale = side / Math.max(bitmap.width, bitmap.height);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, (side - width) / 2, (side - height) / 2, width, height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, side, side);
    tintLogo(pixels.data, background, ink);
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}
