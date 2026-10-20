import type { PrintableExpose } from "@/domain/expose/print";
import { exposePdfFilename } from "@/domain/expose/print";

/**
 * Renders the exposé PDF in the browser and saves it. React-PDF and the
 * layout load only now, on the first click (ADR-0037, ADR-0058).
 */
export async function downloadExposePdf(
  doc: PrintableExpose,
  selected?: Record<string, string[]>,
): Promise<{ missingImages: number }> {
  const { renderExposePdf } = await import("./expose-document");
  const { blob, missingImages } = await renderExposePdf(doc, selected);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exposePdfFilename(doc.company);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { missingImages };
}
