const relative = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });
const absolute = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/** „vor 5 Minuten“, „gestern“, „vor 3 Tagen“; older dates as a plain date. */
export function formatRelative(date: Date, now = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "gerade eben";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 14 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
  return absolute.format(date);
}
