import type {
  InvoiceDocument,
  InvoiceIssuer,
  InvoiceKind,
  InvoiceParty,
  InvoiceStatus,
} from "@/domain/invoices/schema";
import type { InvoiceTotals } from "@/domain/invoices/totals";

/** An invoice as the PDF renderer gets it (serialisable, dates as YYYY-MM-DD). */
export interface PrintableInvoice {
  kind: InvoiceKind;
  status: InvoiceStatus;
  /** Null for a draft: the PDF then says „Entwurf“. */
  number: string | null;
  issueDate: string;
  dueDate: string | null;
  document: InvoiceDocument;
  totals: InvoiceTotals;
  issuer: InvoiceIssuer;
  recipient: InvoiceParty;
  taxNote: string | null;
  /** For a cancellation: the number of the cancelled invoice. */
  cancels: string | null;
  offerNumber: string | null;
  /** EPC QR code („Zahlen mit Code“) as unit squares; null without IBAN. */
  qr: { size: number; path: string } | null;
  /** The agency's look from Einstellungen → Marke: logo URL and an accent readable on white. */
  brand: { logo: string | null; accent: string | null };
}
