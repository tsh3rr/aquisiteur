import type { AssetManifest, ManifestEntry } from "@/db/schema";
import type { KnownPhone } from "@/domain/expose/known-phones";
import type { ExposeImage } from "@/domain/expose/schema";
import type { WorkspaceSettings } from "@/domain/workspace-settings";

/** Shared, serialisable inputs of every block renderer. */
export interface RenderContext {
  mode: "public" | "preview";
  /** URL prefix the asset files are served from on the current host. */
  assetBase: "/assets" | "/preview/assets";
  manifest: AssetManifest;
  settings: WorkspaceSettings;
  ownerPhoto: ManifestEntry | null;
  refCode: string;
  /** Exposé slug, for the public routes (callback form). */
  slug: string;
  prospectName: string;
  workspaceName: string;
  /** Masked numbers the callback form may offer (§7.4). */
  knownPhones: KnownPhone[];
}

export interface ResolvedImage {
  alt: string;
  caption?: string;
  width: number;
  height: number;
  avifSrcSet: string;
  webpSrcSet: string;
  /** PNG renditions, for images uploaded from a browser that cannot encode WebP. */
  pngSrcSet: string;
  src: string;
}

function fileUrl(base: string, key: string): string {
  // Keys look like <workspace>/assets/<sha>/<file>; the host already implies the workspace.
  const [, , sha, file] = key.split("/");
  return `${base}/${sha}/${file}`;
}

export function resolveEntry(
  entry: ManifestEntry | null | undefined,
  base: string,
  alt: string,
  caption?: string,
): ResolvedImage | null {
  if (!entry || entry.kind !== "image" || !entry.width || !entry.height) return null;
  const set = (format: "avif" | "webp" | "png") =>
    entry.variants
      .filter((variant) => variant.format === format && variant.width)
      .sort((a, b) => a.width! - b.width!)
      .map((variant) => `${fileUrl(base, variant.key)} ${variant.width}w`)
      .join(", ");
  const hasWebp = entry.variants.some((variant) => variant.format === "webp");
  const candidates = entry.variants
    .filter((variant) => variant.format === (hasWebp ? "webp" : "png"))
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const fallback = candidates.find((variant) => (variant.width ?? 0) <= 960) ?? candidates[0];
  if (!fallback) return null;
  return {
    alt,
    caption,
    width: entry.width,
    height: entry.height,
    avifSrcSet: set("avif"),
    webpSrcSet: set("webp"),
    pngSrcSet: hasWebp ? "" : set("png"),
    src: fileUrl(base, fallback.key),
  };
}

export function resolveImage(
  image: ExposeImage | undefined,
  context: Pick<RenderContext, "manifest" | "assetBase">,
): ResolvedImage | null {
  if (!image) return null;
  return resolveEntry(context.manifest[image.src], context.assetBase, image.alt, image.caption);
}

export function resolveFile(
  path: string,
  context: Pick<RenderContext, "manifest" | "assetBase">,
): string | null {
  const variant = context.manifest[path]?.variants[0];
  return variant ? fileUrl(context.assetBase, variant.key) : null;
}

export function ownerPhoto(context: RenderContext, alt: string): ResolvedImage | null {
  return resolveEntry(context.ownerPhoto, context.assetBase, alt);
}

/**
 * The largest WebP (or PNG) rendition up to 1600 px, for printed pages: the
 * browser converts it to JPEG for the PDF renderer (ADR-0037).
 */
export function printSource(image: ResolvedImage): string {
  const candidates = (image.webpSrcSet || image.pngSrcSet)
    .split(", ")
    .map((entry) => {
      const [url, width] = entry.split(" ");
      return { url, width: Number.parseInt(width ?? "", 10) };
    })
    .filter((entry) => entry.url && entry.width <= 1600);
  return candidates.at(-1)?.url ?? image.src;
}
