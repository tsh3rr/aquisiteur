import "server-only";
import { printSource, resolveEntry } from "@/components/expose/render-context";
import { exposeImages, printContacts, type PrintableExpose } from "@/domain/expose/print";
import { printColors, type PrintImage } from "@/domain/letters/teaser";
import type { ExposeViewData } from "./load";

/**
 * The input of the exposé PDF (§7.9) from the same data the page renders.
 * `assetBase` is the cockpit preview path or the public one, so the browser
 * fetching the images is allowed to.
 */
export function printableExpose(
  data: ExposeViewData,
  options: { assetBase: "/assets" | "/preview/assets"; url: string | null },
): PrintableExpose {
  const { document, manifest, settings } = data;
  const images: Record<string, PrintImage> = {};
  for (const image of exposeImages(document)) {
    if (images[image.src]) continue;
    const resolved = resolveEntry(manifest[image.src], options.assetBase, image.alt);
    if (!resolved) continue;
    images[image.src] = {
      src: printSource(resolved),
      alt: image.alt,
      width: resolved.width,
      height: resolved.height,
    };
  }
  const photo = resolveEntry(data.ownerPhoto, options.assetBase, "");
  // Stored versions are parsed documents, but older ones may predate `style`.
  const style = document.theme?.style ?? "editorial";
  return {
    title: document.meta.title,
    company: data.prospect.companyName,
    refCode: data.expose.refCode,
    blocks: document.blocks,
    images,
    logo: document.theme?.logo && images[document.theme.logo.src] ? document.theme.logo.src : null,
    style,
    colors: printColors(document.theme?.accent ?? settings.branding.accentColor, style),
    owner: {
      name: settings.profile.displayName ?? data.workspace.name,
      role: settings.profile.role ?? null,
      company: settings.senderAddress.company ?? data.workspace.name,
      photo: photo ? printSource(photo) : null,
      contacts: printContacts(settings.channels),
    },
    url: options.url,
  };
}
