import { INTERVAL_MONTHS, type RecurringInterval } from "../offers/schema";
import type { OfferTotals } from "../offers/totals";
import { ratio } from "./period";

/**
 * Project dashboard (§7.10, phase 7c-5, ADR-0076): what offers, invoices and
 * maintenance contracts bring in. Pure; the queries live in
 * `src/server/analytics/business.ts`.
 */

const RECURRING: RecurringInterval[] = ["monthly", "quarterly", "halfyearly", "yearly"];

/** Net value of an offer: the one-off part plus twelve months of the recurring part. */
export function offerValueCents(totals: Pick<OfferTotals, "buckets">): number {
  let cents = totals.buckets.once?.netCents ?? 0;
  for (const interval of RECURRING) {
    const bucket = totals.buckets[interval];
    if (bucket) cents += Math.round((bucket.netCents * 12) / INTERVAL_MONTHS[interval]);
  }
  return cents;
}

/** Monthly recurring revenue of one contract: its net per period spread over the months. */
export function monthlyCents(interval: RecurringInterval, periodNetCents: number): number {
  return periodNetCents / INTERVAL_MONTHS[interval];
}

export interface AnsweredOffer {
  status: "accepted" | "declined";
  sentAt: Date;
  answeredAt: Date;
}

/**
 * Of the offers answered in the period: the share accepted and the average
 * days from sending to the acceptance. Withdrawn and unanswered ones do not count.
 */
export function acceptance(offers: readonly AnsweredOffer[]) {
  const accepted = offers.filter((offer) => offer.status === "accepted");
  const days = accepted.map(
    (offer) => (offer.answeredAt.getTime() - offer.sentAt.getTime()) / 86_400_000,
  );
  return {
    answered: offers.length,
    accepted: accepted.length,
    rate: ratio(accepted.length, offers.length),
    avgDays: days.length > 0 ? days.reduce((sum, value) => sum + value, 0) / days.length : null,
  };
}

/** "3,5 Tage" without Intl (cockpit only, but kept in line with ADR-0048). */
export function formatDays(days: number | null): string {
  if (days === null) return "–";
  if (days < 1) return "unter 1 Tag";
  const rounded = Math.round(days * 10) / 10;
  const text = String(rounded).replace(".", ",");
  return rounded === 1 ? "1 Tag" : `${text} Tage`;
}

export interface CampaignRevenue {
  campaignId: string | null;
  name: string;
  netCents: number;
  invoices: number;
}

/** Highest first; „Ohne Kampagne“ last whatever its amount. */
export function sortRevenue(rows: CampaignRevenue[]): CampaignRevenue[] {
  return [...rows].sort((a, b) =>
    a.campaignId === null ? 1 : b.campaignId === null ? -1 : b.netCents - a.netCents,
  );
}

/** The twelve calendar months ("2026-10") up to the one holding the period's last day. */
export function monthsUntil(lastDay: string, count = 12): string[] {
  const year = Number(lastDay.slice(0, 4));
  const month = Number(lastDay.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - (count - 1 - index), 1));
    return date.toISOString().slice(0, 7);
  });
}

export interface MonthRevenue {
  month: string;
  /** Project invoices: standard, deposit and final, less their cancellations. */
  oneOffCents: number;
  /** Maintenance contract invoices, less their cancellations. */
  recurringCents: number;
}

/** One point per month, zero where nothing was invoiced. */
export function fillMonths(
  months: readonly string[],
  rows: readonly { month: string; recurring: boolean; netCents: number }[],
): MonthRevenue[] {
  const byMonth = new Map(
    months.map((month) => [month, { month, oneOffCents: 0, recurringCents: 0 }]),
  );
  for (const row of rows) {
    const point = byMonth.get(row.month);
    if (!point) continue;
    if (row.recurring) point.recurringCents += row.netCents;
    else point.oneOffCents += row.netCents;
  }
  return [...byMonth.values()];
}

export const AGING_BUCKETS = ["current", "d30", "d60", "older"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Noch nicht fällig",
  d30: "1–30 Tage überfällig",
  d60: "31–60 Tage überfällig",
  older: "Über 60 Tage überfällig",
};

/** Bucket of an open invoice by the days since its due date (0 or less: not yet due). */
export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d30";
  if (daysOverdue <= 60) return "d60";
  return "older";
}

export interface AgingRow {
  bucket: AgingBucket;
  label: string;
  count: number;
  openCents: number;
}

export function buildAging(
  invoices: readonly { daysOverdue: number; openCents: number }[],
): AgingRow[] {
  const rows = new Map<AgingBucket, AgingRow>(
    AGING_BUCKETS.map((bucket) => [
      bucket,
      { bucket, label: AGING_LABELS[bucket], count: 0, openCents: 0 },
    ]),
  );
  for (const invoice of invoices) {
    const row = rows.get(agingBucket(invoice.daysOverdue))!;
    row.count += 1;
    row.openCents += invoice.openCents;
  }
  return [...rows.values()];
}

export interface StageRow {
  stage: string;
  label: string;
  count: number;
  /** Share of the first stage. */
  rate: number | null;
  /** Share lost since the previous stage. */
  dropOff: number | null;
}

/** Offers sent in the period: sent → viewed online → accepted. */
export function offerFunnel(counts: {
  sent: number;
  viewed: number;
  accepted: number;
}): StageRow[] {
  const stages = [
    { stage: "sent", label: "Versendet", count: counts.sent },
    { stage: "viewed", label: "Online angesehen", count: counts.viewed },
    { stage: "accepted", label: "Angenommen", count: counts.accepted },
  ];
  return stages.map((row, index) => {
    const before = index === 0 ? null : stages[index - 1]!.count;
    return {
      ...row,
      rate: ratio(row.count, counts.sent),
      dropOff: before === null || before === 0 ? null : (before - row.count) / before,
    };
  });
}

interface OfferFigures {
  sent: number;
  volumeCents: number;
  rate: number | null;
  avgDays: number | null;
}

export interface BusinessFigures {
  offers: OfferFigures;
  previousOffers: OfferFigures;
  revenue: { netCents: number; byCampaign: CampaignRevenue[] };
  previousRevenue: { netCents: number };
  open: { openCents: number; overdueCents: number };
  contracts: { mrrCents: number };
}

type Cell = string | number | null;

/** CSV rows of the project dashboard: the figures, then revenue per campaign under its own header. */
export function businessCsvRows(data: BusinessFigures): Cell[][] {
  const { offers: o, previousOffers: po } = data;
  const euro = (cents: number) => cents / 100;
  const percent = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 10);
  const days = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
  return [
    ["Bereich", "Name", "Zeitraum", "Vorperiode"],
    ["Kennzahl", "Versendete Angebote", o.sent, po.sent],
    ["Kennzahl", "Angebotsvolumen netto (EUR)", euro(o.volumeCents), euro(po.volumeCents)],
    ["Kennzahl", "Annahmequote (%)", percent(o.rate), percent(po.rate)],
    ["Kennzahl", "Ø Tage bis zur Annahme", days(o.avgDays), days(po.avgDays)],
    [
      "Kennzahl",
      "Umsatz netto (EUR)",
      euro(data.revenue.netCents),
      euro(data.previousRevenue.netCents),
    ],
    ["Stand heute", "Offene Posten (EUR)", euro(data.open.openCents), null],
    ["Stand heute", "Davon überfällig (EUR)", euro(data.open.overdueCents), null],
    ["Stand heute", "MRR netto (EUR)", euro(data.contracts.mrrCents), null],
    [],
    ["Umsatz je Kampagne", "Kampagne", "Umsatz netto (EUR)", "Rechnungen"],
    ...data.revenue.byCampaign.map((row) => [
      "Umsatz je Kampagne",
      row.name,
      euro(row.netCents),
      row.invoices,
    ]),
  ];
}
