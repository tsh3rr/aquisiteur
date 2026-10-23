import { formatCents } from "../offers/totals";
import {
  addMonths,
  calendarPeriod,
  INTERVAL_PERIOD_LABELS,
  type ContractInterval,
} from "./maintenance";
import type { InvoiceLine } from "./schema";
import { addDays } from "../tasks";
import { germanDate } from "./totals";

/**
 * Wertsicherung (§7.10, phase 7c-3b, ADR-0075): the prices of a maintenance
 * contract follow the Austrian consumer price index (VPI 2020) once a year.
 * The owner enters the published index values; an adjustment is announced
 * to the customer and applies from the first period that starts after the
 * notice. Changes inside the threshold are ignored and accumulate, and the
 * clause works both ways, so a falling index lowers the price.
 */

export const INDEX_NAME = "VPI 2020";
export const INDEX_SOURCE_URL =
  "https://www.statistik.at/statistiken/volkswirtschaft-und-oeffentliche-finanzen/preise-und-preisindizes/verbraucherpreisindex-vpi/hvpi";

export const ADJUSTMENT_STATUSES = ["skipped", "announced", "applied", "withdrawn"] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export const ADJUSTMENT_STATUS_LABELS: Record<AdjustmentStatus, string> = {
  skipped: "Keine Anpassung",
  announced: "Angekündigt",
  applied: "Angewendet",
  withdrawn: "Zurückgezogen",
};

export const MONTH_NAMES = [
  "Jänner",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

/** "2026-09" → "September 2026". */
export function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return `${MONTH_NAMES[(number ?? 1) - 1]} ${year}`;
}

/** Index values are kept in tenths (128,7 → 1287), as Statistik Austria publishes them. */
export function formatIndex(tenths: number): string {
  return (tenths / 10).toFixed(1).replace(".", ",");
}

/** "128,7" or "128.7" → 1287; null when it is not a positive value with at most one decimal. */
export function parseIndex(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  if (!/^\d{1,4}(\.\d)?$/.test(cleaned)) return null;
  const tenths = Math.round(Number(cleaned) * 10);
  return tenths > 0 ? tenths : null;
}

/** Signed change in percent, two decimals: 128,7 → 132,6 is +3,03. */
export function indexChangePercent(baseTenths: number, currentTenths: number): number {
  return Math.round(((currentTenths - baseTenths) / baseTenths) * 10_000) / 100;
}

export function formatChange(percent: number): string {
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "±";
  return `${sign}${Math.abs(percent).toFixed(2).replace(".", ",")} %`;
}

/** Within the threshold („Schwankungsraum“) the price stays and the base is kept. */
export function withinThreshold(percent: number, thresholdPercent: number): boolean {
  return percent === 0 || Math.abs(percent) < thresholdPercent;
}

/** New prices: each unit price times current / base, rounded to the cent. */
export function indexedLines(
  lines: InvoiceLine[],
  baseTenths: number,
  currentTenths: number,
): InvoiceLine[] {
  return lines.map((line) => ({
    ...line,
    unitPriceCents: Math.round((line.unitPriceCents * currentTenths) / baseTenths),
  }));
}

/**
 * The day the next adjustment is due: the first of the index month, a year
 * after the last adjustment's day (or at least a year after the start).
 */
export function nextIndexDate(
  terms: { startDate: string; indexMonth: number },
  lastAdjustment: string | null,
): string {
  const earliest = lastAdjustment ? addDays(lastAdjustment, 1) : addMonths(terms.startDate, 12);
  const [year, month, day] = earliest.split("-").map(Number) as [number, number, number];
  const sameYear = month < terms.indexMonth || (month === terms.indexMonth && day === 1);
  const candidateYear = sameYear ? year : year + 1;
  const candidate = `${candidateYear}-${String(terms.indexMonth).padStart(2, "0")}-01`;
  // A late adjustment on, say, 1 February must not bring the next one forward to 1 January.
  return lastAdjustment && candidate < addMonths(lastAdjustment, 11)
    ? `${candidateYear + 1}-${String(terms.indexMonth).padStart(2, "0")}-01`
    : candidate;
}

/**
 * When an adjustment announced today takes effect: the due day, or the start
 * of the first period after the notice, so no period is billed at two prices.
 */
export function effectiveDate(
  interval: ContractInterval,
  dueOn: string,
  today: string,
  noticeDays: number,
): string {
  const earliest = [dueOn, addDays(today, noticeDays)].sort().at(-1)!;
  const period = calendarPeriod(interval, earliest);
  return period.from === earliest ? earliest : addDays(period.to, 1);
}

export const INDEX_EMAIL_SUBJECT = "Wertsicherung Ihres Wartungsvertrags ab {ab}";
export const INDEX_EMAIL_BODY = `Guten Tag,

wie vereinbart ist der Preis Ihres Wartungsvertrags „{vertrag}“ an den Verbraucherpreisindex ({indexname}) gebunden. Der Index ist von {basis} ({basismonat}) auf {index} ({indexmonat}) {richtung}, das sind {aenderung}.

Ab {ab} gelten daher diese Preise:
{aufstellung}

Sie müssen nichts weiter tun. Bei Fragen antworten Sie einfach auf diese E-Mail.

Mit freundlichen Grüßen
{absender}`;

export interface IndexAnnouncement {
  contractTitle: string;
  interval: ContractInterval;
  baseMonth: string;
  baseTenths: number;
  indexMonth: string;
  indexTenths: number;
  effectiveFrom: string;
  oldLines: InvoiceLine[];
  newLines: InvoiceLine[];
  sender: string;
}

export function indexEmailValues(input: IndexAnnouncement) {
  const change = indexChangePercent(input.baseTenths, input.indexTenths);
  const per = INTERVAL_PERIOD_LABELS[input.interval];
  return {
    vertrag: input.contractTitle,
    indexname: INDEX_NAME,
    basis: formatIndex(input.baseTenths),
    basismonat: monthLabel(input.baseMonth),
    index: formatIndex(input.indexTenths),
    indexmonat: monthLabel(input.indexMonth),
    richtung: change >= 0 ? "gestiegen" : "gesunken",
    aenderung: formatChange(change),
    ab: germanDate(input.effectiveFrom),
    aufstellung: input.newLines
      .map((line, index) => {
        const before = input.oldLines[index]?.unitPriceCents ?? line.unitPriceCents;
        return `${line.title}: ${formatCents(before)} → ${formatCents(line.unitPriceCents)} pro ${per} (netto)`;
      })
      .join("\n"),
    absender: input.sender,
  };
}

export interface AdjustmentPlan {
  changePercent: number;
  /** Inside the threshold: nothing changes and the base stays. */
  within: boolean;
  newLines: InvoiceLine[];
  effectiveFrom: string;
}

/**
 * What entering an index value means for a contract: the change against the
 * base, the new prices and the first period they apply to. A period billed
 * already (in advance) keeps its price.
 */
export function planAdjustment(input: {
  lines: InvoiceLine[];
  interval: ContractInterval;
  baseTenths: number;
  indexTenths: number;
  thresholdPercent: number;
  dueOn: string;
  today: string;
  noticeDays: number;
  billedUntil: string | null;
}): AdjustmentPlan {
  const changePercent = indexChangePercent(input.baseTenths, input.indexTenths);
  const within = withinThreshold(changePercent, input.thresholdPercent);
  const notBefore =
    input.billedUntil && addDays(input.billedUntil, 1) > input.dueOn
      ? addDays(input.billedUntil, 1)
      : input.dueOn;
  return {
    changePercent,
    within,
    newLines: within ? input.lines : indexedLines(input.lines, input.baseTenths, input.indexTenths),
    effectiveFrom: effectiveDate(input.interval, notBefore, input.today, input.noticeDays),
  };
}

/**
 * The cycle the next index value is for, or null when the contract is not
 * indexed, has no start yet or ends before it. Withdrawn announcements free
 * their cycle again.
 */
export function nextCycle(
  contract: {
    indexed: boolean;
    startDate: string | null;
    endDate: string | null;
    indexMonth: number;
  },
  adjustments: readonly { status: AdjustmentStatus; dueOn: string; effectiveFrom: string | null }[],
): string | null {
  if (!contract.indexed || !contract.startDate) return null;
  const last = adjustments
    .filter((adjustment) => adjustment.status !== "withdrawn")
    .reduce<(typeof adjustments)[number] | null>(
      (latest, adjustment) => (!latest || adjustment.dueOn > latest.dueOn ? adjustment : latest),
      null,
    );
  const dueOn = nextIndexDate(
    { startDate: contract.startDate, indexMonth: contract.indexMonth },
    // One cycle a year in the index month, even when the last price came late.
    last ? last.dueOn : null,
  );
  return contract.endDate && dueOn > contract.endDate ? null : dueOn;
}
