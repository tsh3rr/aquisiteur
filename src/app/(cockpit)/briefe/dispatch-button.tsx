"use client";

import { Send } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  dispatchLettersAction,
  printableLettersAction,
  uploadLetterPdfAction,
  type BulkState,
} from "./actions";

/**
 * „Per Pingen versenden“ (§7.9): renders each draft's PDF in the browser
 * (React-PDF, loaded on demand), stores it on the server and hands the
 * letters to Pingen. Pingen charges per letter, so it asks once before.
 * Focus moves to the question and back, so keyboard and screen reader users
 * stay where they were (WCAG 2.4.3).
 */
export function DispatchButton({
  ids,
  staging,
  onDone,
}: {
  ids: string[];
  staging: boolean;
  onDone: (result: BulkState) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState("");
  const [pending, startTransition] = useTransition();
  const question = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const count = ids.length;
  const letters = `${count} ${count === 1 ? "Brief" : "Briefe"}`;

  useEffect(() => {
    if (confirming) question.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [confirming]);

  const close = () => {
    returnFocus.current = true;
    setConfirming(false);
  };

  const send = () =>
    startTransition(async () => {
      close();
      try {
        setProgress("PDFs werden erstellt …");
        const { renderLettersPdf } = await import("@/components/letters/letter-document");
        const printable = await printableLettersAction(ids);
        let stored = 0;
        for (const letter of printable) {
          const { blob } = await renderLettersPdf([letter]);
          const form = new FormData();
          form.set("id", letter.id);
          form.set("pdf", new File([blob], `brief-${letter.id}.pdf`, { type: "application/pdf" }));
          if (await uploadLetterPdfAction(form)) stored += 1;
          setProgress(`PDF ${stored} von ${printable.length} hochgeladen …`);
        }
        setProgress("Briefe werden an Pingen übergeben …");
        onDone(await dispatchLettersAction(ids));
      } catch (error) {
        console.error(error);
        onDone({
          ok: false,
          message: "Die Briefe konnten nicht übergeben werden. Bitte erneut versuchen.",
        });
      } finally {
        setProgress("");
      }
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      {confirming ? (
        <span
          role="group"
          aria-label="Versand bestätigen"
          className="inline-flex flex-wrap items-center gap-3"
        >
          <span ref={question} tabIndex={-1} className="text-sm outline-none">
            {staging
              ? `${letters} an die Pingen-Testumgebung senden? Dort wird nichts gedruckt.`
              : `${letters} kostenpflichtig über Pingen drucken und versenden?`}
          </span>
          <Button onClick={send}>Ja, senden</Button>
          <Button variant="secondary" onClick={close}>
            Abbrechen
          </Button>
        </span>
      ) : (
        <Button
          ref={trigger}
          variant="secondary"
          onClick={() => setConfirming(true)}
          disabled={pending || count === 0}
        >
          <Send aria-hidden />
          {pending ? "Wird übergeben …" : "Per Pingen versenden"}
        </Button>
      )}
      <span aria-live="polite" className="text-sm text-foreground-muted">
        {progress}
      </span>
    </span>
  );
}
