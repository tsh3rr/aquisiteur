import "server-only";
import type { Transaction } from "@/db";
import type { PrintableInvoice } from "@/components/invoices/types";
import { epcPayload } from "@/domain/invoices/epc";
import { readableOn } from "@/domain/letters/teaser";
import { modulesPath } from "@/domain/tracking/qr";
import { brandPrintSource } from "../brand-images";
import { loadInvoice } from "./manage";

/** An invoice as the browser renders it to PDF (and Factur-X): data, EPC QR path and brand. */
export async function printableInvoice(
  tx: Transaction,
  workspaceId: string,
  invoiceId: string,
): Promise<PrintableInvoice | null> {
  const loaded = await loadInvoice(tx, workspaceId, invoiceId);
  if (!loaded) return null;
  const { invoice, issuer, recipient, totals, document, settings } = loaded;
  const logo = await brandPrintSource(tx, workspaceId, settings.branding.logoAssetId);
  const accentHex = settings.branding.accentColor;
  const payload =
    issuer.iban && invoice.number && invoice.kind !== "cancellation"
      ? epcPayload({
          name: issuer.name,
          iban: issuer.iban,
          bic: issuer.bic,
          amountCents: totals.dueCents,
          reference: invoice.number,
        })
      : null;
  return {
    kind: invoice.kind,
    status: invoice.status,
    number: invoice.number,
    issueDate: invoice.issueDate ?? loaded.today,
    dueDate: invoice.dueDate,
    document,
    totals,
    issuer,
    recipient,
    taxNote: loaded.taxNote,
    cancels: loaded.cancels?.number ?? null,
    offerNumber: loaded.offer?.number ?? null,
    qr: payload ? modulesPath(payload) : null,
    brand: { logo, accent: accentHex ? readableOn(accentHex, "#ffffff") : null },
  };
}
