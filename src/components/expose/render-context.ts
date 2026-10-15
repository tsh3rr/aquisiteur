import type { AssetManifest, ManifestEntry } from "@/db/schema";
import type { ExposeImage } from "@/domain/expose/schema";
import type { WorkspaceSettings } from "@/domain/workspace-settings";

/** Shared, serialisable inputs of every block renderer. */
export interface RenderContext {
  mode: "public" | "preview";
  /** URL prefix the asset files are served from on the current host. */
  assetBase: "/assets" | "/exposes/assets";
  manifest: AssetManifest;
  settings: WorkspaceSettings;
  ownerPhoto: ManifestEntry | null;
  refCode: string;
  prospectName: string;
  workspaceName: string;
}

export interface ResolvedImage {
  alt: string;
  caption?: string;
  width: number;
  height: number;
  avifSrcSet: string;
  webpSrcSet: string;
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
  const set = (format: "avif" | "webp") =>
    entry.variants
      .filter((variant) => variant.format === format && variant.width)
      .sort((a, b) => a.width! - b.width!)
      .map((variant) => `${fileUrl(base, variant.key)} ${variant.width}w`)
      .join(", ");
  const webp = entry.variants
    .filter((variant) => variant.format === "webp")
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const fallback = webp.find((variant) => (variant.width ?? 0) <= 960) ?? webp[0];
  if (!fallback) return null;
  return {
    alt,
    caption,
    width: entry.width,
    height: entry.height,
    avifSrcSet: set("avif"),
    webpSrcSet: set("webp"),
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
