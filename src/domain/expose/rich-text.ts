/**
 * Tiny Markdown subset for exposé texts. Parses into a plain tree that
 * React renders as elements, so authored text can never become HTML.
 *
 * Supported: paragraphs (blank line), "- " lists, **bold**, *italic*,
 * [text](https://… | mailto:… | tel:…). Everything else is literal text.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "break" };

export type RichBlock =
  { kind: "paragraph"; children: Inline[] } | { kind: "list"; items: Inline[][] };

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:)/i;

export function parseRichText(source: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  const chunks = source.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const chunk of chunks) {
    const lines = chunk.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      blocks.push({
        kind: "list",
        items: lines.map((line) => parseInline(line.replace(/^\s*[-*]\s+/, ""))),
      });
      continue;
    }
    const children: Inline[] = [];
    lines.forEach((line, index) => {
      if (index > 0) children.push({ kind: "break" });
      children.push(...parseInline(line.trim()));
    });
    blocks.push({ kind: "paragraph", children });
  }
  return blocks;
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };

  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const [match, label = "", href = ""] = link;
      flush();
      if (SAFE_HREF.test(href)) {
        out.push({ kind: "link", href, children: parseInline(label) });
      } else {
        out.push(...parseInline(label));
      }
      i += match.length;
      continue;
    }

    const strong = /^\*\*(.+?)\*\*/.exec(rest);
    if (strong) {
      flush();
      out.push({ kind: "strong", children: parseInline(strong[1] ?? "") });
      i += strong[0].length;
      continue;
    }

    const em = /^\*([^*\s][^*]*?)\*/.exec(rest);
    if (em) {
      flush();
      out.push({ kind: "em", children: parseInline(em[1] ?? "") });
      i += em[0].length;
      continue;
    }

    buffer += source[i];
    i += 1;
  }
  flush();
  return out;
}

/** Plain text without markup, e.g. for meta descriptions and mailto bodies. */
export function richTextToPlain(source: string): string {
  const inline = (nodes: Inline[]): string =>
    nodes
      .map((node) =>
        node.kind === "text" ? node.text : node.kind === "break" ? "\n" : inline(node.children),
      )
      .join("");
  return parseRichText(source)
    .map((block) =>
      block.kind === "paragraph"
        ? inline(block.children)
        : block.items.map((item) => `- ${inline(item)}`).join("\n"),
    )
    .join("\n\n");
}
