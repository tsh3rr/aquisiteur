"use client";

import { FileDown } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { PrintableExpose } from "@/domain/expose/print";
import { downloadExposePdf } from "./download";

/** „Als PDF herunterladen“ in the cockpit, e.g. to print the exposé as a letter enclosure. */
export function ExposePdfButton({ load }: { load: () => Promise<PrintableExpose | null> }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const download = () =>
    startTransition(async () => {
      setMessage("PDF wird erstellt …");
      try {
        const doc = await load();
        if (!doc) {
          setMessage("Diese Version gibt es nicht mehr.");
          return;
        }
        const { missingImages } = await downloadExposePdf(doc);
        setMessage(
          missingImages > 0
            ? `PDF erstellt. ${missingImages} ${missingImages === 1 ? "Bild konnte" : "Bilder konnten"} nicht geladen werden, bitte erneut herunterladen.`
            : "PDF erstellt.",
        );
      } catch (error) {
        console.error(error);
        setMessage("Das PDF konnte nicht erstellt werden. Bitte erneut versuchen.");
      }
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={download} disabled={pending}>
        <FileDown aria-hidden />
        {pending ? "Wird erstellt …" : "Als PDF herunterladen"}
      </Button>
      <span aria-live="polite" className="text-sm text-foreground-muted">
        {message}
      </span>
    </span>
  );
}
