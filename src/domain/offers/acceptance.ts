import { z } from "zod";
import { offerSelectionSchema } from "./schema";

/**
 * Answering an offer on its public page (§7.10 „Online-Annahme“). The body
 * of the public POST, and what is stored as evidence: who, when, which
 * version (by checksum) and what was chosen at which price. No IP address.
 */

const name = z.string().trim().min(2, "Bitte Ihren Namen angeben.").max(120);

export const offerAnswerSchema = z.discriminatedUnion("answer", [
  z
    .object({
      answer: z.literal("accept"),
      /** The version the visitor saw; a newer one means they must reload. */
      versionId: z.uuid(),
      name,
      role: z.string().trim().max(120).optional(),
      confirmed: z.literal(true, { error: "Bitte bestätigen Sie die Beauftragung." }),
      selection: offerSelectionSchema,
      /** Honeypot: people never fill it (ADR-0066). */
      website: z.string().max(200).optional(),
    })
    .strict(),
  z
    .object({
      answer: z.literal("decline"),
      versionId: z.uuid(),
      reason: z.string().trim().max(1000).optional(),
      website: z.string().max(200).optional(),
    })
    .strict(),
]);
export type OfferAnswer = z.output<typeof offerAnswerSchema>;

export interface OfferAcceptance {
  name: string;
  role: string | null;
  acceptedAt: string;
  versionId: string;
  version: number;
  sha256: string;
  variantId: string | null;
  variantTitle: string | null;
  optionalIds: string[];
  /** One-off total and the recurring totals per interval, in cents, as shown on the page. */
  onceTotalCents: number;
  recurring: { interval: string; totalCents: number }[];
  taxMode: string;
}

/**
 * Canonical JSON for the version checksum: keys sorted, so the same content
 * always gives the same hash however it was built.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Next number of a series, e.g. offerNumber("AN", 2026, 7) → "AN-2026-0007". */
export function seriesNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

/** Validity end: `days` after the send date (a local YYYY-MM-DD). */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
