import { addDays } from "../tasks";
import type { InvoiceLine } from "./schema";
import { INTERVAL_MONTHS, type RecurringInterval } from "../offers/schema";

/**
 * Maintenance contracts (§7.10, phase 7c-3, ADR-0073): the recurring lines of
 * an accepted offer, billed per calendar period (month, quarter, half-year,
 * year) in advance or in arrears. The first and last period are prorated by
 * days. Dates are local calendar dates (YYYY-MM-DD).
 */

export const CONTRACT_INTERVALS = ["monthly", "quarterly", "halfyearly", "yearly"] as const;
export type ContractInterval = RecurringInterval;

export const CONTRACT_TIMINGS = ["advance", "arrears"] as const;
export type ContractTiming = (typeof CONTRACT_TIMINGS)[number];

export const CONTRACT_TIMING_LABELS: Record<ContractTiming, string> = {
  advance: "im Voraus",
  arrears: "nachträglich",
};

export const INTERVAL_PERIOD_LABELS: Record<ContractInterval, string> = {
  monthly: "Monat",
  quarterly: "Quartal",
  halfyearly: "Halbjahr",
  yearly: "Jahr",
};

/** At most this many periods per contract and run, so a long gap catches up in steps. */
export const MAX_PERIODS_PER_RUN = 12;

export interface ContractTerms {
  interval: ContractInterval;
  timing: ContractTiming;
  /** Null while the start is open (e.g. „ab Go-live“): nothing is billed yet. */
  startDate: string | null;
  /** Last day of service after a notice; null while the contract runs. */
  endDate: string | null;
  /** Last day already billed; null before the first invoice. */
  billedUntil: string | null;
}

export interface ContractPeriod {
  from: string;
  to: string;
  /** Days of service in this period and days of the full calendar period. */
  days: number;
  periodDays: number;
  full: boolean;
}

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year!, month!, day!];
}

function iso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}

/** Last day of the month `months` after the month of `date`. */
export function endOfMonth(date: string, months = 0): string {
  const [year, month] = parts(date);
  return iso(year, month + months + 1, 0);
}

/** The same day `months` later, clamped to the month's end (31.01. + 1 → 28./29.02.). */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = parts(date);
  const last = Number(endOfMonth(iso(year, month + months, 1)).slice(8));
  return iso(year, month + months, Math.min(day, last));
}

/** The calendar period of `interval` that contains `date`. */
export function calendarPeriod(
  interval: ContractInterval,
  date: string,
): { from: string; to: string } {
  const [year, month] = parts(date);
  const length = INTERVAL_MONTHS[interval];
  const first = Math.floor((month - 1) / length) * length + 1;
  return { from: iso(year, first, 1), to: iso(year, first + length, 0) };
}

/** The period that starts on `from`: to the end of its calendar period or the contract's end. */
export function periodFrom(
  terms: Pick<ContractTerms, "interval" | "endDate">,
  from: string,
): ContractPeriod | null {
  if (terms.endDate && from > terms.endDate) return null;
  const calendar = calendarPeriod(terms.interval, from);
  const to = terms.endDate && terms.endDate < calendar.to ? terms.endDate : calendar.to;
  const periodDays = daysBetween(calendar.from, calendar.to);
  const days = daysBetween(from, to);
  return { from, to, days, periodDays, full: days === periodDays };
}

/** In advance on the first day of the period, in arrears the day after it ends. */
export function billingDate(period: Pick<ContractPeriod, "from" | "to">, timing: ContractTiming) {
  return timing === "advance" ? period.from : addDays(period.to, 1);
}

/** The next period to bill, or null when the start is open or everything is billed. */
export function nextPeriod(terms: ContractTerms): ContractPeriod | null {
  if (!terms.startDate) return null;
  const from = terms.billedUntil ? addDays(terms.billedUntil, 1) : terms.startDate;
  return periodFrom(terms, from);
}

/** Periods whose billing date has come, oldest first. */
export function duePeriods(
  terms: ContractTerms,
  today: string,
  max = MAX_PERIODS_PER_RUN,
): ContractPeriod[] {
  const due: ContractPeriod[] = [];
  let cursor = { ...terms };
  for (let period = nextPeriod(cursor); period && due.length < max; period = nextPeriod(cursor)) {
    if (billingDate(period, terms.timing) > today) break;
    due.push(period);
    cursor = { ...cursor, billedUntil: period.to };
  }
  return due;
}

export function prorate(cents: number, period: Pick<ContractPeriod, "days" | "periodDays">) {
  return period.days === period.periodDays
    ? cents
    : Math.round((cents * period.days) / period.periodDays);
}

/** The invoice lines for one period: a partial period has prorated prices and says so. */
export function periodLines(lines: InvoiceLine[], period: ContractPeriod): InvoiceLine[] {
  if (period.full) return lines;
  const note = `Anteilig: ${period.days} von ${period.periodDays} Tagen`;
  return lines.map((line) => ({
    ...line,
    unitPriceCents: prorate(line.unitPriceCents, period),
    description: line.description ? `${line.description}\n${note}` : note,
  }));
}

/**
 * The earliest end after a notice received on `noticeOn`: the end of the
 * month the notice period ends in, and not before the minimum term is over.
 */
export function earliestEnd(
  terms: { startDate: string | null; minimumMonths: number; noticeMonths: number },
  noticeOn: string,
): string {
  const byNotice = endOfMonth(noticeOn, terms.noticeMonths);
  const candidates = [byNotice];
  if (terms.startDate) {
    if (terms.minimumMonths > 0) {
      candidates.push(addDays(addMonths(terms.startDate, terms.minimumMonths), -1));
    }
    candidates.push(terms.startDate);
  }
  return candidates.reduce((a, b) => (b > a ? b : a));
}

export type ContractState = "pending" | "active" | "ending" | "ended";

export const CONTRACT_STATE_LABELS: Record<ContractState, string> = {
  pending: "Beginn offen",
  active: "Läuft",
  ending: "Gekündigt",
  ended: "Beendet",
};

export const CONTRACT_STATE_TONES: Record<ContractState, "neutral" | "accent" | "warning"> = {
  pending: "neutral",
  active: "accent",
  ending: "warning",
  ended: "neutral",
};

export function contractState(
  terms: Pick<ContractTerms, "startDate" | "endDate">,
  today: string,
): ContractState {
  if (!terms.startDate) return "pending";
  if (terms.endDate && terms.endDate < today) return "ended";
  if (terms.endDate) return "ending";
  return "active";
}

const lineKey = (line: InvoiceLine) =>
  [
    line.title,
    line.description ?? "",
    line.quantity,
    line.unit,
    line.unitPriceCents,
    line.discountPercent,
    line.vatRate,
  ].join("\u0000");

/** Same lines as the last invoice: what „automatisch“ may send without a look (§7.10). */
export function sameLines(a: InvoiceLine[], b: InvoiceLine[]): boolean {
  return a.length === b.length && a.every((line, index) => lineKey(line) === lineKey(b[index]!));
}
