"use client";

import { FileArchive } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { PrintableInvoice } from "./types";

type Archive =
  { ok: true; csv: string; invoices: PrintableInvoice[] } | { ok: false; message: string };

/**
 * „ZIP für Oktober 2026“ for the tax adviser (§7.10): the month's CSV and
 * every issued invoice as Factur-X PDF. Rendered and zipped in the browser;
 * React-PDF and fflate load on the first click (ADR-0037).
 */
export function MonthZipButton({
  month,
  label,
  load,
}: {
  month: string;
  label: string;
  load: (month: string) => Promise<Archive>;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const download = () =>
    startTransition(async () => {
      setMessage("ZIP wird erstellt …");
      try {
        const archive = await load(month);
        if (!archive.ok) {
          setMessage(archive.message);
          return;
        }
        const [{ renderInvoicePdf }, { zipSync, strToU8 }] = await Promise.all([
          import("./invoice-document"),
          import("fflate"),
        ]);
        const files: Record<string, Uint8Array> = {
          [`rechnungen-${month}.csv`]: strToU8(archive.csv),
        };
        for (const [index, invoice] of archive.invoices.entries()) {
          setMessage(`PDF ${index + 1} von ${archive.invoices.length} …`);
          const blob = await renderInvoicePdf(invoice);
          files[`${invoice.number}.pdf`] = new Uint8Array(await blob.arrayBuffer());
        }
        // PDFs are compressed already; storing them keeps the ZIP fast.
        const zip = zipSync(files, { level: 0 });
        const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `rechnungen-${month}.zip`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setMessage(
          archive.invoices.length === 1
            ? "ZIP mit 1 Rechnung erstellt."
            : `ZIP mit ${archive.invoices.length} Rechnungen erstellt.`,
        );
      } catch (error) {
        console.error(error);
        setMessage("Das ZIP konnte nicht erstellt werden. Bitte erneut versuchen.");
      }
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={download} disabled={pending}>
        <FileArchive aria-hidden />
        {pending ? "Wird erstellt …" : label}
      </Button>
      <span aria-live="polite" className="text-sm text-foreground-muted">
        {message}
      </span>
    </span>
  );
}
