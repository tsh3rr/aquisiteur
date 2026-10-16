"use client";

import { FileDown } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { PrintableLetterData } from "./types";

/**
 * Downloads the PDF of some letters. The layout data comes from the server;
 * React-PDF is loaded only on the first click and renders in the browser.
 */
export function LetterPdfButton({
  ids,
  load,
  filename,
  label = "PDF herunterladen",
  variant = "secondary",
}: {
  ids: string[];
  load: (ids: string[]) => Promise<PrintableLetterData[]>;
  filename: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const download = () =>
    startTransition(async () => {
      setMessage("PDF wird erstellt …");
      try {
        const letters = await load(ids);
        const { renderLettersPdf } = await import("./letter-document");
        const blob = await renderLettersPdf(letters);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        const problems = letters.filter((letter) => letter.problems.length > 0).length;
        setMessage(
          problems > 0
            ? `PDF erstellt. ${problems} ${problems === 1 ? "Brief hat" : "Briefe haben"} Hinweise, siehe Liste.`
            : `PDF mit ${letters.length} ${letters.length === 1 ? "Brief" : "Briefen"} erstellt.`,
        );
      } catch (error) {
        console.error(error);
        setMessage("Das PDF konnte nicht erstellt werden. Bitte erneut versuchen.");
      }
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <Button variant={variant} onClick={download} disabled={pending || ids.length === 0}>
        <FileDown aria-hidden />
        {pending ? "Wird erstellt …" : label}
      </Button>
      <span aria-live="polite" className="text-sm text-foreground-muted">
        {message}
      </span>
    </span>
  );
}
