import { DEFAULT_CONTACT_CHANNELS, type BlockOf, type ExposeDocument } from "./schema";

/**
 * Expiry of an exposé (§7.3 „Ablauf“): after a configurable number of days
 * without activity the public link shows a short page instead of the full
 * exposé. Nothing is stored when it expires: the state follows from the
 * last activity, so a new version, a newly posted letter or the owner's
 * „Wieder voll anzeigen“ make it current again without a job (ADR-0078).
 */

export const EXPIRY_DAY_MS = 24 * 60 * 60 * 1000;

export interface ExpirySettings {
  enabled: boolean;
  afterDays: number;
}

export interface ExpiryState {
  expired: boolean;
  /** When the full exposé turns into the short page (or did); null when expiry is off. */
  expiresAt: Date | null;
}

export function expiryState(input: {
  lastActivityAt: Date;
  settings: ExpirySettings;
  now?: Date;
}): ExpiryState {
  if (!input.settings.enabled) return { expired: false, expiresAt: null };
  const expiresAt = new Date(
    input.lastActivityAt.getTime() + input.settings.afterDays * EXPIRY_DAY_MS,
  );
  return { expired: (input.now ?? new Date()).getTime() >= expiresAt.getTime(), expiresAt };
}

/**
 * The latest of the moments that keep an exposé current: the current
 * version was published, the owner reset the clock, a letter went out, or
 * someone really read the full exposé. Visits of the short page do not count,
 * otherwise one look would bring the full exposé back.
 */
export function lastActivity(moments: (Date | null | undefined)[]): Date {
  const times = moments.flatMap((moment) => (moment ? [moment.getTime()] : []));
  return new Date(times.length > 0 ? Math.max(...times) : 0);
}

/** Section ids of the short page that do not come from the document. */
export const EXPIRED_SECTIONS = {
  intro: "kurz-einstieg",
  points: "kurz-ideen",
} as const;

export const EXPIRED_SECTION_NAMES: Record<string, string> = {
  [EXPIRED_SECTIONS.intro]: "Kurzseite: Einstieg",
  [EXPIRED_SECTIONS.points]: "Kurzseite: Ideen",
};

export const MAX_EXPIRED_POINTS = 8;

export interface ExpiredPage {
  /** The first comparison slider of the exposé, without its intro text. */
  beforeAfter: BlockOf<"before_after"> | null;
  /** Headings only: what would change. Proposal titles, else the findings. */
  points: string[];
  contact: BlockOf<"contact">;
}

/**
 * What the short page shows, derived from the current version (§7.3). No
 * separate content to author: the page is a reduced view of the same
 * document, so it always matches the letter the prospect received.
 */
export function expiredPage(document: ExposeDocument): ExpiredPage {
  const beforeAfter = document.blocks.find(
    (block): block is BlockOf<"before_after"> => block.type === "before_after",
  );
  const titles = (type: "proposal" | "findings") =>
    document.blocks.flatMap((block) =>
      block.type === type ? block.items.map((item) => item.title) : [],
    );
  const proposals = titles("proposal");
  const points = [...new Set(proposals.length > 0 ? proposals : titles("findings"))].slice(
    0,
    MAX_EXPIRED_POINTS,
  );
  const authored = document.blocks.find(
    (block): block is BlockOf<"contact"> => block.type === "contact",
  );
  return {
    beforeAfter: beforeAfter ? { ...beforeAfter, intro: undefined } : null,
    points,
    contact: {
      id: authored?.id ?? "kontakt",
      type: "contact",
      title: "Lassen Sie uns kurz sprechen",
      intro: "Wählen Sie einfach den Weg, der Ihnen am liebsten ist.",
      channels: authored?.channels ?? [...DEFAULT_CONTACT_CHANNELS],
      message: authored?.message,
    },
  };
}
