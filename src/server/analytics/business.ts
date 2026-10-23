import "server-only";
import { sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import type { TaxMode } from "@/domain/billing";
import {
  acceptance,
  buildAging,
  fillMonths,
  monthlyCents,
  monthsUntil,
  offerValueCents,
  sortRevenue,
  type AnsweredOffer,
  type CampaignRevenue,
} from "@/domain/analytics/business";
import { isoDay, lastDay, previousPeriod, type Period } from "@/domain/analytics/period";
import { invoiceDocumentSchema, type InvoiceLine } from "@/domain/invoices/schema";
import { invoiceTotals } from "@/domain/invoices/totals";
import type { OfferAcceptance } from "@/domain/offers/acceptance";
import { offerDocumentSchema, type RecurringInterval } from "@/domain/offers/schema";
import { defaultSelection, offerTotals } from "@/domain/offers/totals";
import { localDateString } from "@/domain/tasks";
import { prospectScope, type AnalyticsFilter } from "./filters";

/**
 * Project dashboard (§7.10, phase 7c-5, ADR-0076). Runs as tenant; every
 * query joins the prospect and applies the dashboard filters, so a campaign
 * filter narrows offers, invoices and contracts alike.
 */

interface OfferRow extends Record<string, unknown> {
  status: string;
  sent_at: Date | string;
  answered_at: Date | string | null;
  first_viewed_at: Date | string | null;
  acceptance: OfferAcceptance | null;
  document: unknown;
  tax_mode: string;
}

const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

function valueOf(row: OfferRow): number {
  const parsed = offerDocumentSchema.safeParse(row.document);
  if (!parsed.success) return 0;
  const selection = row.acceptance
    ? { variantId: row.acceptance.variantId, optionalIds: row.acceptance.optionalIds }
    : defaultSelection(parsed.data);
  return offerValueCents(offerTotals(parsed.data, selection, row.tax_mode as TaxMode));
}

/** The version an offer was accepted in, else the one last sent (alias `o`). */
const OFFER_VERSION = sql`v.workspace_id = o.workspace_id
  and v.id = coalesce((o.acceptance ->> 'versionId')::uuid, o.current_version_id)`;

async function offerFigures(
  tx: Transaction,
  scope: ReturnType<typeof prospectScope>,
  period: Period,
) {
  const from = period.from.toISOString();
  const to = period.to.toISOString();
  const sent = await tx.execute<OfferRow>(sql`
    select o.status, o.sent_at, o.answered_at, o.first_viewed_at, o.acceptance, v.document,
           v.tax_mode
    from offers o
    join prospects p on p.workspace_id = o.workspace_id and p.id = o.prospect_id
    join offer_versions v on ${OFFER_VERSION}
    where ${scope} and o.sent_at >= ${from} and o.sent_at < ${to}`);
  const answered = await tx.execute<{
    status: "accepted" | "declined";
    sent_at: Date | string;
    answered_at: Date | string;
  }>(sql`
    select o.status, o.sent_at, o.answered_at
    from offers o
    join prospects p on p.workspace_id = o.workspace_id and p.id = o.prospect_id
    where ${scope} and o.status in ('accepted', 'declined') and o.sent_at is not null
      and o.answered_at >= ${from} and o.answered_at < ${to}`);
  const offers: AnsweredOffer[] = answered.map((row) => ({
    status: row.status,
    sentAt: asDate(row.sent_at),
    answeredAt: asDate(row.answered_at),
  }));
  return {
    sent: sent.length,
    volumeCents: sent.reduce((sum, row) => sum + valueOf(row), 0),
    // An answer implies the offer was seen, also when it was answered in the cockpit.
    viewed: sent.filter(
      (row) => row.first_viewed_at !== null || ["accepted", "declined"].includes(row.status),
    ).length,
    acceptedOfSent: sent.filter((row) => row.status === "accepted").length,
    ...acceptance(offers),
  };
}

/** Net revenue invoiced in the period; a cancellation counts negative in its own period. */
async function revenue(tx: Transaction, scope: ReturnType<typeof prospectScope>, period: Period) {
  const rows = await tx.execute<{
    campaign_id: string | null;
    name: string | null;
    net: string;
    invoices: string;
  }>(sql`
    select p.campaign_id, c.name,
           coalesce(sum((i.totals ->> 'netCents')::bigint
             - coalesce((i.totals ->> 'deductedNetCents')::bigint, 0)), 0) as net,
           count(*) filter (where i.kind <> 'cancellation') as invoices
    from invoices i
    join prospects p on p.workspace_id = i.workspace_id and p.id = i.prospect_id
    left join campaigns c on c.workspace_id = p.workspace_id and c.id = p.campaign_id
    where ${scope} and i.status <> 'draft' and i.issue_date >= ${isoDay(period.from)}
      and i.issue_date < ${isoDay(period.to)}
    group by p.campaign_id, c.name`);
  const byCampaign: CampaignRevenue[] = rows.map((row) => ({
    campaignId: row.campaign_id,
    name: row.campaign_id ? (row.name ?? "Kampagne") : "Ohne Kampagne",
    netCents: Number(row.net),
    invoices: Number(row.invoices),
  }));
  return {
    netCents: byCampaign.reduce((sum, row) => sum + row.netCents, 0),
    invoices: byCampaign.reduce((sum, row) => sum + row.invoices, 0),
    byCampaign: sortRevenue(byCampaign),
  };
}

/** Today's open items: issued invoices with something left to pay. */
async function openItems(tx: Transaction, scope: ReturnType<typeof prospectScope>, today: string) {
  const rows = await tx.execute<{ days: number; open: string }>(sql`
    select (${today}::date - i.due_date) as days, open
    from (
      select i.due_date,
             (i.totals ->> 'dueCents')::bigint - coalesce(
               (select sum(pay.amount_cents) from invoice_payments pay
                where pay.workspace_id = i.workspace_id and pay.invoice_id = i.id), 0) as open
      from invoices i
      join prospects p on p.workspace_id = i.workspace_id and p.id = i.prospect_id
      where ${scope} and i.status = 'issued' and i.kind <> 'cancellation'
    ) i
    where open > 0`);
  const invoices = rows.map((row) => ({
    daysOverdue: Number(row.days),
    openCents: Number(row.open),
  }));
  const aging = buildAging(invoices);
  return {
    count: invoices.length,
    openCents: invoices.reduce((sum, row) => sum + row.openCents, 0),
    overdueCents: aging
      .filter((row) => row.bucket !== "current")
      .reduce((sum, row) => sum + row.openCents, 0),
    aging,
  };
}

/**
 * Net revenue per calendar month over the twelve months up to the period's
 * end, split into project and maintenance invoices. A cancellation counts
 * with the kind of the invoice it cancels.
 */
async function monthlyRevenue(
  tx: Transaction,
  scope: ReturnType<typeof prospectScope>,
  months: string[],
) {
  const first = `${months[0]}-01`;
  const last = months.at(-1)!;
  const after = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 1));
  const rows = await tx.execute<{ month: string; recurring: boolean; net: string }>(sql`
    select to_char(i.issue_date, 'YYYY-MM') as month,
           coalesce(orig.contract_id, i.contract_id) is not null as recurring,
           sum((i.totals ->> 'netCents')::bigint
             - coalesce((i.totals ->> 'deductedNetCents')::bigint, 0)) as net
    from invoices i
    join prospects p on p.workspace_id = i.workspace_id and p.id = i.prospect_id
    left join invoices orig on orig.workspace_id = i.workspace_id and orig.id = i.cancels_invoice_id
    where ${scope} and i.status <> 'draft' and i.issue_date >= ${first}
      and i.issue_date < ${isoDay(after)}
    group by 1, 2`);
  return fillMonths(
    months,
    rows.map((row) => ({ month: row.month, recurring: row.recurring, netCents: Number(row.net) })),
  );
}

/** MRR today: running maintenance contracts, each period's net spread over its months. */
async function recurring(tx: Transaction, scope: ReturnType<typeof prospectScope>, today: string) {
  const rows = await tx.execute<{ interval: RecurringInterval; lines: InvoiceLine[] }>(sql`
    select m.interval, m.lines
    from maintenance_contracts m
    join prospects p on p.workspace_id = m.workspace_id and p.id = m.prospect_id
    where ${scope} and p.restricted_at is null and m.start_date <= ${today}
      and (m.end_date is null or m.end_date >= ${today})`);
  const mrr = rows.reduce(
    (sum, row) =>
      sum +
      monthlyCents(
        row.interval,
        invoiceTotals(invoiceDocumentSchema.parse({ lines: row.lines })).netCents,
      ),
    0,
  );
  return { contracts: rows.length, mrrCents: Math.round(mrr) };
}

export async function loadBusiness(
  tx: Transaction,
  workspaceId: string,
  filter: AnalyticsFilter,
  period: Period,
  timezone: string,
  now = new Date(),
) {
  const scope = prospectScope(workspaceId, filter);
  const today = localDateString(now, timezone);
  const previous = previousPeriod(period);
  const months = monthsUntil(lastDay(period));
  const [offers, previousOffers, sales, previousSales, open, contracts, byMonth] =
    await Promise.all([
      offerFigures(tx, scope, period),
      offerFigures(tx, scope, previous),
      revenue(tx, scope, period),
      revenue(tx, scope, previous),
      openItems(tx, scope, today),
      recurring(tx, scope, today),
      monthlyRevenue(tx, scope, months),
    ]);
  return {
    offers,
    previousOffers,
    revenue: sales,
    previousRevenue: previousSales,
    open,
    contracts,
    byMonth,
  };
}

export type BusinessData = Awaited<ReturnType<typeof loadBusiness>>;
