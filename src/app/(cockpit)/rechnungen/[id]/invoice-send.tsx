"use client";

import { Send } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { loadInvoicePdfAction, sendInvoiceAction, type SendInvoiceState } from "../actions";

/**
 * Sends the issued invoice by e-mail (§7.10, 7c-2). The first mail renders
 * the PDF here in the browser (ADR-0037) and hands it to the server, which
 * keeps it; later mails and the customer's page reuse that file.
 */
export function SendInvoice({
  invoiceId,
  filename,
  pdfStored,
  draft,
}: {
  invoiceId: string;
  filename: string;
  pdfStored: boolean;
  draft: { to: string; subject: string; body: string };
}) {
  const [state, setState] = useState<SendInvoiceState>({ ok: false });
  const [step, setStep] = useState("");
  const [pending, startTransition] = useTransition();
  const e = (name: string) => state.errors?.[name];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        if (!pdfStored) {
          setStep("PDF wird erstellt …");
          const printable = await loadInvoicePdfAction(invoiceId);
          if (!printable) {
            setState({ ok: false, message: "Rechnung nicht gefunden." });
            return;
          }
          const { renderInvoicePdf } = await import("@/components/invoices/invoice-document");
          const blob = await renderInvoicePdf(printable);
          formData.set("pdf", new File([blob], filename, { type: "application/pdf" }));
        }
        setStep("Wird gesendet …");
        setState(await sendInvoiceAction(formData));
      } catch (error) {
        console.error(error);
        setState({ ok: false, message: "Senden fehlgeschlagen. Bitte erneut versuchen." });
      } finally {
        setStep("");
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Field label="An" error={e("to")}>
        <Input name="to" type="email" required defaultValue={draft.to} autoComplete="off" />
      </Field>
      <Field label="Betreff" error={e("subject")}>
        <Input name="subject" required maxLength={200} defaultValue={draft.subject} />
      </Field>
      <Field
        label="Text"
        hint={`Das PDF ${filename} hängt an; der Link führt zur Rechnungsseite.`}
        error={e("body")}
      >
        <Textarea name="body" rows={8} required maxLength={4000} defaultValue={draft.body} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Send aria-hidden />
          {pending ? step || "Wird gesendet …" : "Per E-Mail senden"}
        </Button>
      </div>
      <div aria-live="polite">
        {state.message ? (
          <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>
        ) : null}
      </div>
    </form>
  );
}
