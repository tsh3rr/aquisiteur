import { light } from "@/design/tokens";
import type { ExposeDocument, ExposeImage } from "@/domain/expose/schema";
import { deriveAccent, styleScheme } from "@/domain/expose/theme";
import { clampChroma, contrastRatio, ensureContrast, hexToOklch, oklchToHex } from "@/lib/color";

/**
 * The teaser page of a printed letter (§7.9 „Exposé-Vorschau im Brief“):
 * headline, image and up to three ideas of the exposé, in its colours, so
 * the letter already shows what the QR code opens. Built from the blocks;
 * `letter.teaser` in the exposé overrides single fields.
 */
export interface LetterTeaser {
  eyebrow: string | null;
  headline: string;
  lead: string | null;
  /** Exposé asset paths, resolved to URLs by the server. */
  image: ExposeImage | null;
  logo: ExposeImage | null;
  ideasTitle: string;
  ideas: { title: string; text: string; benefit: string | null }[];
  /** sRGB hex for the PDF renderer, each text colour at least 4.5:1 on its background. */
  colors: {
    accent: string;
    onAccent: string;
    accentSoft: string;
    onAccentSoft: string;
    ink: string;
    muted: string;
  };
}

export const MAX_TEASER_IDEAS = 3;

/**
 * `fg` as hex with at least 4.5:1 on `bg`, checked after rounding to hex:
 * the rounding alone can cost a few hundredths of the ratio.
 */
export function readableOn(fg: string, bg: string): string {
  const background = hexToOklch(bg);
  let color = hexToOklch(fg);
  let hex = fg;
  for (let step = 0; step < 20; step++) {
    hex = oklchToHex(color);
    if (contrastRatio(hexToOklch(hex), background) >= 4.5) return hex;
    color = clampChroma(ensureContrast(color, background, 4.5 + 0.02 * (step + 1)));
  }
  return hex;
}

/** Shortens at a word boundary so a long text cannot push the page over. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")} …`;
}

/** Strips the Markdown subset of rich text down to plain words. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1")
    .replace(/^- /gm, "");
}

export function buildLetterTeaser(document: ExposeDocument): LetterTeaser | null {
  const override = document.letter?.teaser;
  if (override?.enabled === false) return null;

  const find = <T extends ExposeDocument["blocks"][number]["type"]>(type: T) =>
    document.blocks.find(
      (block): block is Extract<ExposeDocument["blocks"][number], { type: T }> =>
        block.type === type,
    );
  const hero = find("hero");
  const proposal = find("proposal");
  const findings = find("findings");
  const beforeAfter = find("before_after");
  const gallery = find("mockup_gallery");

  const ideas =
    override?.ideas?.map((idea) => ({ title: idea.title, text: idea.text, benefit: null })) ??
    proposal?.items.map((item) => ({
      title: item.title,
      text: item.description,
      benefit: item.benefit,
    })) ??
    findings?.items.map((item) => ({ title: item.title, text: item.solution, benefit: null })) ??
    [];

  // Stored versions are parsed documents, but older ones may predate `style`.
  const theme = document.theme ?? {};
  const style = theme.style ?? "editorial";
  const accentFamily = deriveAccent(
    theme.accent ? hexToOklch(theme.accent) : light.accent,
    "light",
    style,
  );
  const neutrals = styleScheme(style, "light");
  const accent = readableOn(oklchToHex(accentFamily.accent), "#ffffff");
  const accentSoft = oklchToHex(accentFamily.accentSoft);

  const lead = override?.lead ?? hero?.lead ?? document.meta.description ?? null;
  return {
    eyebrow: hero?.eyebrow ?? null,
    headline: clip(override?.headline ?? hero?.headline ?? document.meta.title, 120),
    lead: lead ? clip(plain(lead), 260) : null,
    image: override?.image ?? hero?.image ?? beforeAfter?.after ?? gallery?.images[0] ?? null,
    logo: theme.logo ?? null,
    ideasTitle: clip(
      override?.ideas ? "Meine Ideen für Sie" : (proposal?.title ?? "Meine Ideen für Sie"),
      60,
    ),
    ideas: ideas.slice(0, MAX_TEASER_IDEAS).map((idea) => ({
      title: clip(idea.title, 60),
      text: clip(plain(idea.text), 170),
      benefit: idea.benefit ? clip(idea.benefit, 90) : null,
    })),
    colors: {
      accent,
      onAccent: readableOn(oklchToHex(accentFamily.accentForeground), accent),
      accentSoft,
      onAccentSoft: readableOn(oklchToHex(accentFamily.accentSoftForeground), accentSoft),
      ink: readableOn(oklchToHex(neutrals.foreground), accentSoft),
      muted: readableOn(oklchToHex(neutrals.foregroundMuted), accentSoft),
    },
  };
}
