import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderExposeJsonSchema } from "./json-schema";
import { BLOCK_TYPES, collectAssetPaths, validateExpose, type ExposeInput } from "./schema";

const examplesDir = join(process.cwd(), "exposes");
const examples = readdirSync(examplesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function minimal(overrides: Partial<ExposeInput> = {}): ExposeInput {
  return {
    schemaVersion: 1,
    prospect: { key: "cafe-test", company: "Café Test" },
    meta: { title: "Test" },
    blocks: [{ id: "start", type: "hero", greeting: "Hallo,", headline: "Überschrift" }],
    ...overrides,
  };
}

describe("example exposés", () => {
  it.each(examples)("exposes/%s/expose.json is valid", (name) => {
    const input: unknown = JSON.parse(readFileSync(join(examplesDir, name, "expose.json"), "utf8"));
    const result = validateExpose(input);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it("together use every block type", () => {
    const used = new Set<string>();
    for (const name of examples) {
      const result = validateExpose(
        JSON.parse(readFileSync(join(examplesDir, name, "expose.json"), "utf8")),
      );
      if (result.ok) result.document.blocks.forEach((block) => used.add(block.type));
    }
    expect([...used].sort()).toEqual(
      [...BLOCK_TYPES].filter((type) => type !== "personal_note" || used.has(type)).sort(),
    );
  });
});

describe("validateExpose()", () => {
  it("accepts a minimal document and fills defaults", () => {
    const result = validateExpose(minimal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.theme.appearance).toBe("auto");
    expect(result.document.meta.lang).toBe("de");
  });

  it("reports readable paths with block type and id", () => {
    const result = validateExpose(
      minimal({
        blocks: [
          { id: "start", type: "hero", greeting: "Hallo,", headline: "" },
          { id: "start", type: "faq", title: "FAQ", items: [] },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.issues.map((issue) => issue.path);
    expect(paths).toContain('blocks[0] (hero "start").headline');
    expect(paths).toContain('blocks[1] (faq "start").items');
    expect(result.issues.some((issue) => issue.message.includes("doppelt"))).toBe(true);
  });

  it("rejects unknown fields, unknown block types and HTML-ish asset paths", () => {
    const bad = validateExpose({
      ...minimal(),
      extra: true,
      blocks: [
        { id: "x1", type: "iframe" },
        {
          id: "x2",
          type: "mockup_gallery",
          title: "G",
          images: [{ src: "../../etc/passwd.png", alt: "" }],
        },
      ],
    });
    expect(bad.ok).toBe(false);
  });

  it("requires captions for videos", () => {
    const result = validateExpose(
      minimal({
        blocks: [
          {
            id: "note",
            type: "personal_note",
            body: "Text",
            video: { src: "assets/v.mp4", title: "Video" } as never,
          },
        ],
      }),
    );
    expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toEqual([
      'blocks[0] (personal_note "note").video.captions',
    ]);
  });

  it("requires cta targets to point at an existing block", () => {
    const result = validateExpose(
      minimal({
        blocks: [{ id: "go", type: "cta", headline: "Los", label: "Kontakt", target: "fehlt" }],
      }),
    );
    expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toEqual([
      'blocks[0] (cta "go").target',
    ]);
  });

  it("rejects price ranges that go backwards", () => {
    const result = validateExpose(
      minimal({
        blocks: [
          {
            id: "preise",
            type: "pricing",
            title: "Preise",
            options: [{ id: "a", title: "A", price: 500, priceTo: 100 }],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("collectAssetPaths()", () => {
  it("lists every referenced asset once", () => {
    const result = validateExpose(
      JSON.parse(readFileSync(join(examplesDir, "cafe-mueller", "expose.json"), "utf8")),
    );
    if (!result.ok) throw new Error("example invalid");
    const paths = collectAssetPaths(result.document);
    expect(paths).toContain("assets/logo-cafe-mueller.svg");
    expect(paths).toContain("assets/vorher.svg");
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("schema/expose.schema.json", () => {
  it("is up to date (run `pnpm expose:schema`)", () => {
    expect(readFileSync(join(process.cwd(), "schema/expose.schema.json"), "utf8")).toBe(
      renderExposeJsonSchema(),
    );
  });
});
