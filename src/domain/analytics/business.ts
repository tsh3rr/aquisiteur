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
