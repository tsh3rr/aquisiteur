import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  collectAssetPaths,
  EXPOSE_STYLES,
  exposeSchema,
  type ExposeDocument,
} from "@/domain/expose/schema";
import { clampChroma, contrastRatio, hexToOklch, oklchToHex } from "@/lib/color";
import { buildLetterTeaser, clip } from "./teaser";

const example = (name: string): ExposeDocument =>
  exposeSchema.parse(JSON.parse(readFileSync(`exposes/${name}/expose.json`, "utf8")));

describe("buildLetterTeaser()", () => {
  it("takes headline, image and the first three ideas from the exposé", () => {
    const teaser = buildLetterTeaser(example("physio-lindenhof"))!;
    expect(teaser.headline).toBe("Ihre Patienten buchen selbst. Sie behandeln in Ruhe.");
    expect(teaser.eyebrow).toBe("Für die Praxis Lindenhof");
    expect(teaser.image?.src).toBe("assets/mockup-startseite.svg");
    expect(teaser.logo?.src).toBe("assets/logo-lindenhof.svg");
    expect(teaser.ideasTitle).toBe("Meine Ideen für Sie");
    expect(teaser.ideas.map((idea) => idea.title)).toEqual([
      "Termine online",
      "Freundliche Website",
      "Gut gefunden werden",
    ]);
    expect(teaser.ideas[0]!.benefit).toBe("Weniger Anrufe während der Behandlung.");
    expect(teaser.style).toBe("soft");
  });

  it("shows before and after in phones when the exposé has a phone screen", () => {
    const document = example("physio-lindenhof");
    expect(buildLetterTeaser(document)!.beforeAfter).toMatchObject({
      kind: "phones",
      before: { src: "assets/vorher.svg" },
      beforeIsDesktop: true,
      after: { src: "assets/nachher-handy.svg" },
      beforeLabel: "Heute",
      afterLabel: "Vorschlag",
    });
    const desktopOnly = {
      ...document,
      blocks: document.blocks.map((block) =>
        block.type === "before_after" ? { ...block, afterMobile: undefined } : block,
      ),
    };
    expect(buildLetterTeaser(desktopOnly)!.beforeAfter).toMatchObject({
      kind: "screens",
      after: { src: "assets/nachher.svg" },
    });
    expect(collectAssetPaths(document)).toContain("assets/nachher-handy.svg");
  });

  it("keeps every text colour at 4.5:1 on the paper it is printed on, for any accent", () => {
    const base = example("physio-lindenhof");
    const ratio = (fg: string, bg: string) => contrastRatio(hexToOklch(fg), hexToOklch(bg));
    for (const style of EXPOSE_STYLES) {
      for (let hue = 0; hue < 360; hue += 30) {
        for (const [l, c] of [
          [0.35, 0.08],
          [0.55, 0.15],
          [0.7, 0.1],
          [0.9, 0.18],
        ] as const) {
          const accent = oklchToHex(clampChroma({ l, c, h: hue }));
          const { colors } = buildLetterTeaser({
            ...base,
            theme: { ...base.theme, accent, style },
          })!;
          const label = `${style} ${accent}`;
          expect(ratio(colors.accent, "#ffffff"), label).toBeGreaterThanOrEqual(4.5);
          expect(ratio(colors.onAccent, colors.accent), label).toBeGreaterThanOrEqual(4.5);
          expect(ratio(colors.onAccentSoft, colors.accentSoft), label).toBeGreaterThanOrEqual(4.5);
          expect(ratio(colors.muted, colors.accentSoft), label).toBeGreaterThanOrEqual(4.5);
          expect(ratio(colors.ink, colors.accentSoft), label).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("lets the exposé override single fields or switch the page off", () => {
    const document = example("physio-lindenhof");
    const withOverride = exposeSchema.parse({
      ...document,
      letter: {
        ...document.letter!,
        teaser: {
          enabled: true,
          headline: "Termine, ohne dass das Telefon klingelt",
          lead: "Kurz und **knapp**.",
          image: { src: "assets/nachher.svg", alt: "Neue Startseite" },
          ideas: [{ title: "Online buchen", text: "Rund um die Uhr." }],
        },
      },
    });
    const teaser = buildLetterTeaser(withOverride)!;
    expect(teaser.headline).toBe("Termine, ohne dass das Telefon klingelt");
    expect(teaser.ideas).toEqual([
      { title: "Online buchen", text: "Rund um die Uhr.", benefit: null },
    ]);
    expect(teaser.lead).toBe("Kurz und knapp.");
    expect(teaser.image?.src).toBe("assets/nachher.svg");
    expect(collectAssetPaths(withOverride)).toContain("assets/nachher.svg");

    expect(
      buildLetterTeaser({
        ...document,
        letter: { ...document.letter!, teaser: { enabled: false } },
      }),
    ).toBeNull();
  });

  it("falls back to findings and the after image without proposal and hero image", () => {
    const document = example("physio-lindenhof");
    const teaser = buildLetterTeaser({
      ...document,
      blocks: document.blocks
        .filter((block) => block.type !== "proposal")
        .map((block) => (block.type === "hero" ? { ...block, image: undefined } : block)),
    })!;
    expect(teaser.image?.src).toBe("assets/nachher.svg");
    expect(teaser.ideas[0]!.title).toBe("Termine nur per Telefon");
  });
});

describe("clip()", () => {
  it("cuts long texts at a word and marks the cut", () => {
    expect(clip("kurz", 10)).toBe("kurz");
    expect(clip("Ein ziemlich langer Satz über Termine", 20)).toBe("Ein ziemlich langer …");
    expect(clip("Zeile\n\nmit   Lücken", 40)).toBe("Zeile mit Lücken");
  });
});
