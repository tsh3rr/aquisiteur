import type { ExposeBlock, ExposeDocument } from "./schema";

/** Title for the table of contents, if the block has one. */
export function blockTitle(block: ExposeBlock): string | null {
  switch (block.type) {
    case "hero":
    case "cta":
      return null;
    case "personal_note":
      return block.title ?? "Persönliche Nachricht";
    default:
      return block.title;
  }
}

/** Names the cockpit uses to describe what a visitor did in an exposé. */
export interface ExposeOutline {
  /** Block id → readable name (hero and CTA get a generic one). */
  blocks: Map<string, string>;
  /** "<blockId>:<optionId>" → option title of a pricing block. */
  pricingOptions: Map<string, string>;
}

export function exposeOutline(document: ExposeDocument | null): ExposeOutline {
  const blocks = new Map<string, string>();
  const pricingOptions = new Map<string, string>();
  for (const block of document?.blocks ?? []) {
    const title =
      blockTitle(block) ?? (block.type === "cta" ? `Button „${block.label}“` : "Einstieg");
    blocks.set(block.id, title);
    if (block.type === "pricing") {
      for (const option of block.options) {
        pricingOptions.set(`${block.id}:${option.id}`, option.title);
      }
    }
  }
  return { blocks, pricingOptions };
}
