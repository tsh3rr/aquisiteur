import { INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, TAX_TREATMENT_LABELS } from "./schema";
import type { InvoiceDisplayStatus, InvoiceKind, TaxTreatment } from "./schema";
import { germanDate } from "./totals";

/**
 * Monthly export for the tax adviser (§7.10): one row per issued invoice,
 * semicolons and decimal commas so Excel in Austria and Germany opens it
 * as it is. UTF-8 with BOM for the umlauts.
 */

export interface CsvInvoice {
  number: string;
  kind: InvoiceKind;
  issueDate: string;
  servicePeriod: string;
  customer: string;
  customerVatId: string | null;
  country: string;
  treatment: TaxTreatment;
  netCents: number;
  vatCents: number;
  totalCents: number;
  deductedCents: number;
  dueCents: number;
  paidCents: number;
  status: InvoiceDisplayStatus;
  cancels: string | null;
}

const HEADER = [
  "Rechnungsnummer",
  "Art",
  "Rechnungsdatum",
  "Leistung",
  "Kunde",
  "UID Kunde",
  "Land",
  "Steuer",
  "Netto",
  "USt",
  "Brutto",
  "Abzug Anzahlungen",
  "Zahlbetrag",
  "Bezahlt",
  "Status",
  "Storno zu",
];

function cell(value: string): string {
  // Leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(value) && !/^-?\d/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

export function invoicesCsv(rows: CsvInvoice[]): string {
  const lines = rows.map((row) =>
    [
      row.number,
      INVOICE_KIND_LABELS[row.kind],
      germanDate(row.issueDate),
      row.servicePeriod,
      row.customer,
      row.customerVatId ?? "",
      row.country,
      TAX_TREATMENT_LABELS[row.treatment],
      money(row.netCents),
      money(row.vatCents),
      money(row.totalCents),
      money(row.deductedCents),
      money(row.dueCents),
      money(row.paidCents),
      INVOICE_STATUS_LABELS[row.status],
      row.cancels ?? "",
    ]
      .map(cell)
      .join(";"),
  );
  return `﻿${[HEADER.join(";"), ...lines].join("\r\n")}\r\n`;
}
