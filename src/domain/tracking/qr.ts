import QRCode from "qrcode";

/**
 * QR codes for letters (§6.2): SVG in millimetres, so print layouts place
 * them at their real size, optionally with a frame and a call to action.
 * Dark modules on white, four modules of quiet zone, error level M.
 */

export const QR_SIZE_MM = 30;
export const FRAMED_WIDTH_MM = 56;
const QUIET_ZONE = 4;

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** One path of unit squares for all dark modules, quiet zone included in `size`. */
export function modulesPath(url: string): { size: number; path: string } {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qr.modules.get(x, y)) path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { size: size + QUIET_ZONE * 2, path };
}

export interface QrOptions {
  url: string;
  /** Frame with call to action and the typed link below. */
  framed?: boolean;
  cta?: string;
  /** Shown under the code in the frame, e.g. "pixelwerk.de/k7m2". */
  caption?: string | null;
}

export const DEFAULT_QR_CTA = "Scannen Sie für Ihre persönlichen Vorschläge";

export function qrSvg({ url, framed = false, cta = DEFAULT_QR_CTA, caption }: QrOptions): string {
  const { size, path } = modulesPath(url);
  const title = `<title>QR-Code: ${escapeXml(url)}</title>`;
  if (!framed) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${QR_SIZE_MM}mm" height="${QR_SIZE_MM}mm" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${title}<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }
  // Frame layout in millimetres: code centred, CTA above, link below.
  const width = FRAMED_WIDTH_MM;
  const code = 36;
  const top = 15;
  const height = top + code + (caption ? 13 : 6);
  const scale = code / size;
  const x = (width - code) / 2;
  const lines = wrap(cta, 32);
  const ctaText = lines
    .map(
      (line, index) =>
        `<text x="${width / 2}" y="${6.5 + index * 4.4}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="3.6" font-weight="700" fill="#000">${escapeXml(line)}</text>`,
    )
    .join("");
  const captionText = caption
    ? `<text x="${width / 2}" y="${top + code + 7}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="3.4" fill="#000">${escapeXml(caption)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">${title}<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="3" fill="#fff" stroke="#000" stroke-width="0.6"/>${ctaText}<g transform="translate(${x} ${top}) scale(${scale})" shape-rendering="crispEdges"><path d="${path}" fill="#000"/></g>${captionText}</svg>`;
}

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}
