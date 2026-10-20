import { light } from "@/design/tokens";
import type { ExposeDocument, ExposeImage, ExposeStyle } from "@/domain/expose/schema";
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
  /**
   * Before and after: two phones when the exposé has a phone screen of the
   * proposal (today's site then shrinks into the phone unless it has its
   * own), otherwise the two desktop screenshots.
   */
  beforeAfter: {
    kind: "phones" | "screens";
    before: ExposeImage;
    /** True when `before` is a desktop screenshot shown inside a phone. */
    beforeIsDesktop: boolean;
    after: ExposeImage;
    beforeLabel: string;
    afterLabel: string;
  } | null;
  /** Headline face follows the exposé style. */
  style: ExposeStyle;
  /** sRGB hex for the PDF renderer, each text colour at least 4.5:1 on its background. */
  colors: {
    accent: string;
    onAccent: string;
    accentSoft: string;
    onAccentSoft: string;
    ink: string;
    muted: string;
    /** Warm or neutral second tint for background shapes, no text on it. */
    paper: string;
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
export function plain(text: string): string {
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

  const beforeAfterBlock = beforeAfter
    ? beforeAfter.afterMobile
      ? {
          kind: "phones" as const,
          before: beforeAfter.beforeMobile ?? beforeAfter.before,
          beforeIsDesktop: !beforeAfter.beforeMobile,
          after: beforeAfter.afterMobile,
        }
      : {
          kind: "screens" as const,
          before: beforeAfter.before,
          beforeIsDesktop: true,
          after: beforeAfter.after,
        }
    : null;

  const lead = override?.lead ?? hero?.lead ?? document.meta.description ?? null;
  return {
    eyebrow: hero?.eyebrow ?? null,
    headline: clip(override?.headline ?? hero?.headline ?? document.meta.title, 120),
    lead: lead ? clip(plain(lead), 260) : null,
    image: override?.image ?? hero?.image ?? beforeAfter?.after ?? gallery?.images[0] ?? null,
    beforeAfter:
      beforeAfter && beforeAfterBlock
        ? {
            ...beforeAfterBlock,
            beforeLabel: clip(beforeAfter.beforeLabel, 24),
            afterLabel: clip(beforeAfter.afterLabel, 24),
          }
        : null,
    style,
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
    colors: printColors(theme.accent, style),
  };
}

export type PrintColors = LetterTeaser["colors"];

/**
 * The exposé's light colours as sRGB hex for printed pages (letter teaser,
 * exposé PDF), every text colour at least 4.5:1 on its background.
 */
export function printColors(accentHex: string | undefined, style: ExposeStyle): PrintColors {
  const accentFamily = deriveAccent(
    accentHex ? hexToOklch(accentHex) : light.accent,
    "light",
    style,
  );
  const neutrals = styleScheme(style, "light");
  const accent = readableOn(oklchToHex(accentFamily.accent), "#ffffff");
  const accentSoft = oklchToHex(accentFamily.accentSoft);
  return {
    accent,
    onAccent: readableOn(oklchToHex(accentFamily.accentForeground), accent),
    accentSoft,
    onAccentSoft: readableOn(oklchToHex(accentFamily.accentSoftForeground), accentSoft),
    ink: readableOn(oklchToHex(neutrals.foreground), accentSoft),
    muted: readableOn(oklchToHex(neutrals.foregroundMuted), accentSoft),
    paper: oklchToHex(neutrals.surfaceSunken),
  };
}

/** An image as the letter renderer gets it: a URL (later a data URL) and its size. */
export type PrintImage = { src: string; alt: string; width: number; height: number };

/** The teaser page with every image as a cockpit URL (still WebP; the browser converts). */
export interface PrintableTeaser extends Omit<LetterTeaser, "image" | "logo" | "beforeAfter"> {
  image: PrintImage | null;
  logo: PrintImage | null;
  beforeAfter:
    | (Omit<NonNullable<LetterTeaser["beforeAfter"]>, "before" | "after"> & {
        before: PrintImage;
        after: PrintImage;
      })
    | null;
  ownerPhoto: string | null;
  /** Sender's phone and e-mail in the call to action; null when the letter leaves them out. */
  contact: { phone: string | null; email: string | null } | null;
  /** The same code as `qrModules`, at level H for the dotted style with a logo in the middle. */
  qr: { size: number; bits: string };
  /**
   * Agency logo for the middle of the code, already tinted onto the accent
   * (JPEG data URL, made in the browser); null leaves a plain accent dot.
   */
  qrLogo: string | null;
}
