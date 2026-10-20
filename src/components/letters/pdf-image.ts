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
