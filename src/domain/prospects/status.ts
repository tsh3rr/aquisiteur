/** Status pipeline (§7.1), in pipeline order. Mirrors the `prospect_status` enum. */
export const PROSPECT_STATUSES = [
  "draft",
  "letter_sent",
  "opened",
  "interested",
  "contacted",
  "meeting",
  "won",
  "lost",
  "no_interest",
] as const;

export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  draft: "Entwurf",
  letter_sent: "Brief versendet",
  opened: "Geöffnet",
  interested: "Interessiert",
  contacted: "Kontakt",
  meeting: "Termin",
  won: "Gewonnen",
  lost: "Verloren",
  no_interest: "Kein Interesse",
};

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** Badge tone; the label always carries the meaning, colour only supports it. */
export const STATUS_TONES: Record<ProspectStatus, StatusTone> = {
  draft: "neutral",
  letter_sent: "neutral",
  opened: "accent",
  interested: "accent",
  contacted: "warning",
  meeting: "warning",
  won: "success",
  lost: "danger",
  no_interest: "danger",
};

export function isProspectStatus(value: unknown): value is ProspectStatus {
  return typeof value === "string" && (PROSPECT_STATUSES as readonly string[]).includes(value);
}
