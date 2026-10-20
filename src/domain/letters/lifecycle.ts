import { z } from "zod";

/**
 * The life of a letter (§7.9), the same for every dispatch provider:
 * draft → queued → submitted → printed → posted → (returned | failed | cancelled).
 * With the `manual` provider the owner downloads the PDF and marks it as
 * posted; the intermediate steps are passed through in one go.
 */
export const LETTER_STATUSES = [
  "draft",
  "queued",
  "submitted",
  "printed",
  "posted",
  "returned",
  "failed",
  "cancelled",
] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

export const LETTER_STATUS_LABELS: Record<LetterStatus, string> = {
  draft: "Entwurf",
  queued: "In der Warteschlange",
  submitted: "Übermittelt",
  printed: "Gedruckt",
  posted: "Versendet",
  returned: "Zurückgekommen",
  failed: "Fehlgeschlagen",
  cancelled: "Storniert",
};

const NEXT: Record<LetterStatus, readonly LetterStatus[]> = {
  draft: ["queued", "cancelled"],
  queued: ["submitted", "failed", "cancelled"],
  submitted: ["printed", "failed", "cancelled"],
  printed: ["posted", "failed"],
  posted: ["returned"],
  returned: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: LetterStatus, to: LetterStatus): boolean {
  return NEXT[from].includes(to);
}

/**
 * The statuses to pass through to reach `to` from `from`, in order, or null
 * when `to` is not reachable. "Als versendet markieren" on a draft walks
 * queued → submitted → printed → posted, so every timestamp is set.
 */
export function pathTo(from: LetterStatus, to: LetterStatus): LetterStatus[] | null {
  if (from === to) return [];
  const queue: { status: LetterStatus; path: LetterStatus[] }[] = [{ status: from, path: [] }];
  const seen = new Set<LetterStatus>([from]);
  while (queue.length > 0) {
    const { status, path } = queue.shift()!;
    for (const next of NEXT[status]) {
      if (seen.has(next)) continue;
      const nextPath = [...path, next];
      if (next === to) return nextPath;
      seen.add(next);
      // Only walk the happy path; side exits end a letter.
      if (!["returned", "failed", "cancelled"].includes(next)) {
        queue.push({ status: next, path: nextPath });
      }
    }
  }
  return null;
}

export const isFinal = (status: LetterStatus) => NEXT[status].length === 0;

/** Letters still counted as "on the way" or sent, i.e. not void. */
export const SENT_STATUSES: readonly LetterStatus[] = ["posted", "returned"];

/** Print options (§7.9), modelled now so print APIs only map them. */
export const printOptionsSchema = z.object({
  color: z.boolean().default(false),
  duplex: z.boolean().default(false),
  shipping: z.enum(["standard", "priority"]).default("standard"),
  /** DL window envelope (DIN 5008 Form B); larger formats come with print APIs. */
  envelope: z.enum(["DL"]).default("DL"),
  /** Second page with a teaser of the exposé (§7.9 „Exposé-Vorschau im Brief“). */
  teaser: z.boolean().default(true),
  /** Phone and e-mail of the sender in the call to action of the teaser page. */
  contact: z.boolean().default(true),
  /** Asset ids of PDFs to enclose; empty in v1. */
  inserts: z.array(z.uuid()).max(5).default([]),
});
export type PrintOptions = z.infer<typeof printOptionsSchema>;
/**
 * As stored in `letters.options`: rows from before the teaser page lack
 * `teaser` and `contact` (both read as true).
 */
export type StoredPrintOptions = Omit<PrintOptions, "teaser" | "contact"> & {
  teaser?: boolean;
  contact?: boolean;
};

export const LETTER_KINDS = ["initial", "follow_up"] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

export const LETTER_STATUS_TONES: Record<
  LetterStatus,
  "neutral" | "accent" | "success" | "warning" | "danger"
> = {
  draft: "neutral",
  queued: "accent",
  submitted: "accent",
  printed: "accent",
  posted: "success",
  returned: "warning",
  failed: "danger",
  cancelled: "neutral",
};

/** "3 Tage" between posting and the first scan (§7.8 „Zeit bis zur Öffnung“). */
export function formatTimeToOpen(postedAt: Date, openedAt: Date): string {
  const hours = Math.max(0, (openedAt.getTime() - postedAt.getTime()) / 3_600_000);
  if (hours < 24) return `${Math.max(1, Math.round(hours))} Std.`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "Tag" : "Tage"}`;
}
