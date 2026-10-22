import { type VatRate } from "../offers/schema";
import { roundCents } from "../offers/totals";
import {
  WITHOUT_VAT,
  type InvoiceDisplayStatus,
  type InvoiceDocument,
  type InvoiceKind,
  type InvoiceLine,
  type RateAmount,
} from "./schema";

/**
 * Invoice arithmetic (§7.10, ADR-0070). Same rules as the offer: each line
 * rounded to whole cents, the overall discount and the VAT per rate on the
 * sum. A cancellation carries the original's lines and is negated here.
 */

export interface InvoiceLineTotals extends InvoiceLine {
  grossLineCents: number;
  lineDiscountCents: number;
  netCents: number;
}

export interface InvoiceTotals {
  lines: InvoiceLineTotals[];
  /** Sum of the lines before the overall discount. */
  linesCents: number;
  discountCents: number;
  netCents: number;
  /** Per rate: base after the discount and the VAT on it (0 without VAT). */
  vat: { rate: VatRate; baseCents: number; vatCents: number }[];
  vatCents: number;
  totalCents: number;
  /** This invoice's own amounts per rate; a final invoice subtracts them later. */
  byRate: RateAmount[];
  deductedNetCents: number;
  deductedVatCents: number;
  deductedCents: number;
  /** What the customer still has to pay: total minus deposits already invoiced. */
  dueCents: number;
}

function lineTotals(line: InvoiceLine): InvoiceLineTotals {
  const grossLineCents = roundCents(line.quantity * line.unitPriceCents);
  const lineDiscountCents = roundCents((grossLineCents * line.discountPercent) / 100);
  return {
    ...line,
    grossLineCents,
    lineDiscountCents,
    netCents: grossLineCents - lineDiscountCents,
  };
}

export function invoiceTotals(
  document: InvoiceDocument,
  kind: InvoiceKind = "standard",
): InvoiceTotals {
  const sign = kind === "cancellation" ? -1 : 1;
  const withoutVat = WITHOUT_VAT.has(document.treatment);
  const lines = document.lines.map(lineTotals);
  const byRateLines = new Map<VatRate, number>();
  for (const line of lines) {
    byRateLines.set(line.vatRate, (byRateLines.get(line.vatRate) ?? 0) + line.netCents);
  }
  const vat = [...byRateLines.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, linesCents]) => {
      const baseCents = linesCents - roundCents((linesCents * document.discountPercent) / 100);
      return {
        rate,
        linesCents: sign * linesCents,
        baseCents: sign * baseCents,
        vatCents: withoutVat ? 0 : sign * roundCents((baseCents * rate) / 100),
      };
    });
  const linesCents = vat.reduce((sum, entry) => sum + entry.linesCents, 0);
  const netCents = vat.reduce((sum, entry) => sum + entry.baseCents, 0);
  const vatCents = vat.reduce((sum, entry) => sum + entry.vatCents, 0);
  const totalCents = netCents + vatCents;
  const deductedNetCents =
    sign *
    document.deductions.reduce((sum, d) => sum + d.byRate.reduce((s, r) => s + r.netCents, 0), 0);
  const deductedVatCents =
    sign *
    document.deductions.reduce((sum, d) => sum + d.byRate.reduce((s, r) => s + r.vatCents, 0), 0);
  const deductedCents = deductedNetCents + deductedVatCents;
  return {
    lines: lines.map((line) =>
      sign === 1
        ? line
        : {
            ...line,
            unitPriceCents: -line.unitPriceCents,
            grossLineCents: -line.grossLineCents,
            lineDiscountCents: -line.lineDiscountCents,
            netCents: -line.netCents,
          },
    ),
    linesCents,
    discountCents: linesCents - netCents,
    netCents,
    vat: vat.map(({ rate, baseCents, vatCents: v }) => ({ rate, baseCents, vatCents: v })),
    vatCents,
    totalCents,
    byRate: vat.map(({ rate, baseCents, vatCents: v }) => ({
      rate,
      netCents: baseCents,
      vatCents: v,
    })),
    deductedNetCents,
    deductedVatCents,
    deductedCents,
    dueCents: totalCents - deductedCents,
  };
}

/**
 * Lines of a deposit invoice for `shareCents` of an offer's one-off total:
 * one line per VAT rate, split in the ratio of the rate bases, so a deposit
 * under 20 % and 13 % keeps both rates. The last rate takes the rounding rest
 * of the net amount.
 */
export function depositLines(
  bases: { rate: VatRate; baseCents: number }[],
  totalCents: number,
  shareCents: number,
  title: string,
): InvoiceLine[] {
  const baseSum = bases.reduce((sum, entry) => sum + entry.baseCents, 0);
  if (baseSum <= 0 || totalCents <= 0) return [];
  const share = Math.min(1, shareCents / totalCents);
  const netTarget = roundCents(baseSum * share);
  let assigned = 0;
  return bases.map((entry, index) => {
    const last = index === bases.length - 1;
    const net = last ? netTarget - assigned : roundCents(entry.baseCents * share);
    assigned += net;
    return {
      id: `anz-${index + 1}`,
      title: bases.length > 1 ? `${title} (${entry.rate} % USt)` : title,
      description: undefined,
      quantity: 1,
      unit: "Pauschal",
      unitPriceCents: Math.max(0, net),
      discountPercent: 0,
      vatRate: entry.rate,
    };
  });
}

/** Paid amount and display status of an issued invoice. */
export function paymentState(
  invoice: {
    kind?: InvoiceKind;
    status: "draft" | "issued" | "cancelled";
    dueDate: string | null;
    dueCents: number;
  },
  paidCents: number,
  today: string,
): InvoiceDisplayStatus {
  if (invoice.status === "draft") return "draft";
  if (invoice.status === "cancelled") return "cancelled";
  // A cancellation is nothing to pay; it only offsets the original.
  if (invoice.kind === "cancellation") return "storno";
  if (invoice.dueCents <= 0 || paidCents >= invoice.dueCents) return "paid";
  if (invoice.dueDate && invoice.dueDate < today) return "overdue";
  return paidCents > 0 ? "partly_paid" : "open";
}

/** "2026-10-22" → "22.10.2026", without Intl (ADR-0048). */
export function germanDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

/** Service date or period as printed: "22.10.2026" or "01.10.2026 – 31.10.2026". */
export function servicePeriodLabel(period: { from: string; to?: string } | undefined): string {
  if (!period) return "–";
  return period.to && period.to !== period.from
    ? `${germanDate(period.from)} – ${germanDate(period.to)}`
    : germanDate(period.from);
}
