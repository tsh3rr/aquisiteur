import { formatQuantity } from "../offers/totals";
import { addDays } from "../tasks";
import { calendarPeriod, type ContractTerms } from "./maintenance";
import type { InvoiceLine } from "./schema";
import { germanDate, servicePeriodLabel } from "./totals";

/**
 * Stundenkontingent (§7.10, phase 7c-3b, ADR-0075): a maintenance contract
 * includes some hours per period. Work is logged against the contract; what
 * goes beyond the quota is billed at the hourly rate on the next invoice
 * (in arrears: on the period's own invoice), rounded up to a quarter hour.
 * Unused hours expire with their period.
 */

export interface TimeEntry {
  workDate: string;
  minutes: number;
  description: string;
}

export function formatHours(minutes: number): string {
  return `${formatQuantity(Math.round((minutes / 60) * 100) / 100)} Std.`;
}

/** "1,5", "1.5", "1:30" or "90min" → minutes; null otherwise. */
export function parseDuration(raw: string): number | null {
  const value = raw.trim().toLowerCase().replace(/\s/g, "");
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) || null;
  const minutes = /^(\d{1,4})min$/.exec(value);
  if (minutes) return Number(minutes[1]) || null;
  const hours = /^(\d{1,3})([.,]\d{1,2})?(h|std\.?)?$/.exec(value);
  if (!hours) return null;
  const total = Math.round(Number(`${hours[1]}${(hours[2] ?? "").replace(",", ".")}`) * 60);
  return total > 0 ? total : null;
}

export function usedMinutes(entries: Pick<TimeEntry, "minutes">[]): number {
  return entries.reduce((sum, entry) => sum + entry.minutes, 0);
}

/** Minutes beyond the quota, rounded up to a quarter hour. */
export function overageMinutes(entries: Pick<TimeEntry, "minutes">[], includedMinutes: number) {
  const over = usedMinutes(entries) - includedMinutes;
  return over > 0 ? Math.ceil(over / 15) * 15 : 0;
}

/**
 * The period whose extra hours the invoice for `period` carries: the one
 * before it when billed in advance, the period itself in arrears; null when
 * there is none or its hours were billed already.
 */
export function overagePeriod(
  terms: Pick<ContractTerms, "interval" | "timing" | "startDate">,
  period: { from: string; to: string },
  overageBilledUntil: string | null,
): { from: string; to: string } | null {
  if (!terms.startDate) return null;
  let span: { from: string; to: string };
  if (terms.timing === "arrears") {
    span = period;
  } else {
    const to = addDays(period.from, -1);
    if (to < terms.startDate) return null;
    const calendar = calendarPeriod(terms.interval, to);
    span = { from: calendar.from < terms.startDate ? terms.startDate : calendar.from, to };
  }
  if (overageBilledUntil && span.to <= overageBilledUntil) return null;
  if (overageBilledUntil && span.from <= overageBilledUntil) {
    span = { ...span, from: addDays(overageBilledUntil, 1) };
  }
  return span;
}

function days(span: { from: string; to: string }): number {
  return (
    Math.round(
      (Date.parse(`${span.to}T00:00:00Z`) - Date.parse(`${span.from}T00:00:00Z`)) / 86_400_000,
    ) + 1
  );
}

/** The quota of a span: whole for a full calendar period, by days for a partial one. */
export function includedForSpan(
  interval: ContractTerms["interval"],
  span: { from: string; to: string },
  includedMinutes: number,
): number {
  const calendar = calendarPeriod(interval, span.from);
  if (calendar.from === span.from && calendar.to === span.to) return includedMinutes;
  return Math.round((includedMinutes * days(span)) / days(calendar));
}

/** The invoice line for extra hours, listing the work behind them. */
export function overageLine(input: {
  entries: TimeEntry[];
  includedMinutes: number;
  hourlyRateCents: number;
  span: { from: string; to: string };
  vatRate: InvoiceLine["vatRate"];
}): InvoiceLine | null {
  const minutes = overageMinutes(input.entries, input.includedMinutes);
  if (minutes === 0) return null;
  const header = `${servicePeriodLabel(input.span)}: ${formatHours(usedMinutes(input.entries))} geleistet, ${formatHours(input.includedMinutes)} enthalten, auf die Viertelstunde aufgerundet.`;
  const lines = [...input.entries]
    .sort((a, b) => a.workDate.localeCompare(b.workDate))
    .map(
      (entry) => `${germanDate(entry.workDate)} ${formatHours(entry.minutes)} ${entry.description}`,
    );
  let description = header;
  for (const line of lines) {
    if (description.length + line.length + 1 > 990) {
      description += "\n…";
      break;
    }
    description += `\n${line}`;
  }
  return {
    id: "extra-hours",
    title: "Zusätzliche Stunden",
    description,
    quantity: minutes / 60,
    unit: "Std.",
    unitPriceCents: input.hourlyRateCents,
    discountPercent: 0,
    vatRate: input.vatRate,
  };
}
