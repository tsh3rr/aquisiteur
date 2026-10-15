import { describe, expect, it } from "vitest";
import { parseInline, parseRichText, richTextToPlain } from "./rich-text";

describe("parseRichText()", () => {
  it("splits paragraphs and lists", () => {
    expect(parseRichText("Eins\nzwei\n\n- a\n- b")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "Eins" },
          { kind: "break" },
          { kind: "text", text: "zwei" },
        ],
      },
      { kind: "list", items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]] },
    ]);
  });

  it("parses bold, italic and safe links", () => {
    expect(parseInline("**fett** und *kursiv* [Web](https://x.de)")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "fett" }] },
      { kind: "text", text: " und " },
      { kind: "em", children: [{ kind: "text", text: "kursiv" }] },
      { kind: "text", text: " " },
      { kind: "link", href: "https://x.de", children: [{ kind: "text", text: "Web" }] },
    ]);
  });

  it("drops unsafe link targets but keeps the label", () => {
    expect(parseInline("[klick](javascript:alert(1))")).toEqual([
      { kind: "text", text: "klick" },
      { kind: "text", text: ")" },
    ]);
    expect(parseInline("<script>alert(1)</script>")).toEqual([
      { kind: "text", text: "<script>alert(1)</script>" },
    ]);
  });

  it("renders plain text", () => {
    expect(richTextToPlain("**Hallo** [Welt](https://x.de)\n\n- a")).toBe("Hallo Welt\n\n- a");
  });
});
