import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  type InvoiceDisplayStatus,
  type InvoiceKind,
} from "@/domain/invoices/schema";
import { formatCents } from "@/domain/offers/totals";

interface Row {
  id: string;
  number: string | null;
  kind: InvoiceKind;
  dueCents: number;
  status: InvoiceDisplayStatus;
}

/** Compact invoice links for the customer, project and offer pages. */
export function InvoiceLinks({ invoices }: { invoices: Row[] }) {
  return (
    <ul className="grid gap-1 text-sm">
      {invoices.map((invoice) => (
        <li key={invoice.id}>
          <Link
            href={`/rechnungen/${invoice.id}`}
            className="flex min-h-11 flex-wrap items-center justify-between gap-2 hover:text-accent"
          >
            <span>
              {invoice.number ?? "Entwurf"}
              <span className="text-foreground-muted">
                {" "}
                · {INVOICE_KIND_LABELS[invoice.kind]} · {formatCents(invoice.dueCents)}
              </span>
            </span>
            <Badge tone={INVOICE_STATUS_TONES[invoice.status]}>
              {INVOICE_STATUS_LABELS[invoice.status]}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
