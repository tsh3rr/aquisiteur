"use client";

import { FileDown } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { PrintableInvoice } from "./types";

/**
 * Downloads the invoice PDF. The data comes from the server; React-PDF is
 * loaded only on the first click and renders in the browser (ADR-0037).
 */
export function InvoicePdfButton({
  invoiceId,
  load,
  filename,
  label = "PDF herunterladen",
}: {
  invoiceId: string;
  load: (invoiceId: string) => Promise<PrintableInvoice | null>;
  filename: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const download = () =>
    startTransition(async () => {
      setMessage("PDF wird erstellt …");
      try {
        const invoice = await load(invoiceId);
        if (!invoice) {
          setMessage("Rechnung nicht gefunden.");
          return;
        }
        const { renderInvoicePdf } = await import("./invoice-document");
        const blob = await renderInvoicePdf(invoice);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setMessage("PDF erstellt.");
      } catch (error) {
        console.error(error);
        setMessage("Das PDF konnte nicht erstellt werden. Bitte erneut versuchen.");
      }
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={download} disabled={pending}>
        <FileDown aria-hidden />
        {pending ? "Wird erstellt …" : label}
      </Button>
      <span aria-live="polite" className="text-sm text-foreground-muted">
        {message}
      </span>
    </span>
  );
}
