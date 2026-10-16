/** Number formats for dashboards, German style. */

const integer = new Intl.NumberFormat("de-DE");
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const euroRound = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export const formatCount = (value: number) => integer.format(value);

export function formatPercent(value: number | null): string {
  return value === null ? "–" : `${integer.format(Math.round(value * 100))} %`;
}

export function formatEuro(cents: number | null, round = false): string {
  if (cents === null) return "–";
  return (round ? euroRound : euro).format(cents / 100);
}

/** "2 Std." / "3,5 Tage" for durations in hours. */
export function formatHours(hours: number | null): string {
  if (hours === null) return "–";
  if (hours < 48) return `${integer.format(Math.round(hours))} Std.`;
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(hours / 24)} Tage`;
}

/** "1:45 Min." / "40 Sek." for durations in seconds. */
export function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "–";
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded} Sek.`;
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")} Min.`;
}

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
export const WEEKDAY_NAMES = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;
