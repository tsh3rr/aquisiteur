/**
 * Reporting periods for the dashboards (§7.8): „Zeitraum frei wählbar“ with
 * a trend against the period of the same length right before it.
 */

export interface Period {
  /** Inclusive start. */
  from: Date;
  /** Exclusive end. */
  to: Date;
}

export const PRESETS = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 } as const;
export type Preset = keyof typeof PRESETS;

export const PRESET_LABELS: Record<Preset, string> = {
  "7d": "Letzte 7 Tage",
  "30d": "Letzte 30 Tage",
  "90d": "Letzte 90 Tage",
  "365d": "Letzte 12 Monate",
};

const DAY = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight UTC of the given calendar day, so periods are whole days. */
function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Reads `zeitraum` (a preset) or `von`/`bis` (ISO days, both inclusive)
 * from the URL. Falls back to the last 30 days; never more than 3 years.
 */
export function parsePeriod(
  params: { zeitraum?: string; von?: string; bis?: string },
  now = new Date(),
): { period: Period; preset: Preset | null } {
  const tomorrow = new Date(startOfDay(now).getTime() + DAY);
  if (params.von && params.bis && ISO_DAY.test(params.von) && ISO_DAY.test(params.bis)) {
    const from = new Date(`${params.von}T00:00:00Z`);
    const to = new Date(new Date(`${params.bis}T00:00:00Z`).getTime() + DAY);
    if (from < to && to.getTime() - from.getTime() <= 3 * 366 * DAY) {
      return { period: { from, to: to > tomorrow ? tomorrow : to }, preset: null };
    }
  }
  const preset = (params.zeitraum ?? "") in PRESETS ? (params.zeitraum as Preset) : "30d";
  return {
    period: { from: new Date(tomorrow.getTime() - PRESETS[preset] * DAY), to: tomorrow },
    preset,
  };
}

export function previousPeriod(period: Period): Period {
  const length = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - length), to: period.from };
}

/** ISO days of the period (for date inputs and series), `to` exclusive. */
export function periodDays(period: Period): string[] {
  const days: string[] = [];
  for (let t = period.from.getTime(); t < period.to.getTime(); t += DAY) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

export function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Inclusive last day, for the „bis“ input. */
export function lastDay(period: Period) {
  return isoDay(new Date(period.to.getTime() - DAY));
}

export type Trend = { direction: "up" | "down" | "flat"; text: string } | null;

/**
 * Change against the previous period in words, e.g. "+12 % ggü. Vorperiode".
 * Null when there is nothing to compare. `points` compares percentages as
 * percentage points.
 */
export function trend(current: number | null, previous: number | null, points = false): Trend {
  if (current === null || previous === null) return null;
  if (current === previous) return { direction: "flat", text: "wie in der Vorperiode" };
  const direction = current > previous ? "up" : "down";
  if (points) {
    const diff = Math.round((current - previous) * 100);
    return { direction, text: `${diff > 0 ? "+" : ""}${diff} Pp. ggü. Vorperiode` };
  }
  if (previous === 0) return { direction, text: "neu in diesem Zeitraum" };
  const change = Math.round(((current - previous) / previous) * 100);
  return { direction, text: `${change > 0 ? "+" : ""}${change} % ggü. Vorperiode` };
}

export const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);
