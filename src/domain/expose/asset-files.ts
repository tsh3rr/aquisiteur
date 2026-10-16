import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "./schema";

/**
 * Rules for files that arrive with a publish (§7.2). Images come already
 * optimised by the CLI as AVIF + WebP renditions; videos and captions are
 * stored as uploaded. The server checks magic bytes, so a renamed file
 * cannot smuggle in other content (e.g. HTML or SVG with scripts).
 */
export type AssetKind = "image" | "video" | "captions";
export type VariantFormat = "avif" | "webp" | "png" | "mp4" | "webm" | "vtt";

export const CONTENT_TYPES: Record<VariantFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
  png: "image/png",
  mp4: "video/mp4",
  webm: "video/webm",
  vtt: "text/vtt; charset=utf-8",
};

export const MAX_BYTES: Record<AssetKind, number> = {
  image: 5 * 1024 * 1024,
  video: 30 * 1024 * 1024,
  captions: 512 * 1024,
};

/** Responsive widths the CLI renders (never upscaled beyond the original). */
export const IMAGE_WIDTHS = [480, 960, 1600] as const;

export function assetKindForPath(path: string): AssetKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  if (ext === "vtt") return "captions";
  throw new Error(`Unsupported asset type: ${path}`);
}

export function allowedFormats(kind: AssetKind): VariantFormat[] {
  switch (kind) {
    case "image":
      return ["avif", "webp", "png"];
    case "video":
      return ["mp4", "webm"];
    case "captions":
      return ["vtt"];
  }
}

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

/** Detects the real format from the first bytes. */
export function sniffFormat(bytes: Uint8Array): VariantFormat | null {
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "webp";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return "png";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    return "mp4";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "webm";
  }
  const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  if (ascii(bytes, offset, offset + 6) === "WEBVTT") return "vtt";
  return null;
}

export function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Storage key of one stored rendition. Always below the workspace prefix (§9a). */
export function variantKey(
  workspaceId: string,
  sha256: string,
  format: VariantFormat,
  width: number | null,
): string {
  return `${workspaceId}/assets/${sha256}/${width ?? "file"}.${format}`;
}

/** Public file name of a rendition, as used in /assets/<sha>/<file>. */
export function variantFileName(format: VariantFormat, width: number | null): string {
  return `${width ?? "file"}.${format}`;
}

export function parseVariantFileName(
  file: string,
): { format: VariantFormat; width: number | null } | null {
  const match = /^(file|\d{2,5})\.(avif|webp|png|mp4|webm|vtt)$/.exec(file);
  if (!match) return null;
  return {
    format: match[2] as VariantFormat,
    width: match[1] === "file" ? null : Number(match[1]),
  };
}
