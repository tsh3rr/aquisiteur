"use client";

import { BellRing, Send } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { loadInvoicePdfAction } from "../actions";
import {
  discardReminderAction,
  prepareReminderAction,
  sendReminderAction,
  type DunningActionState,
} from "../dunning-actions";

function Status({ state }: { state: DunningActionState }) {
  return (
    <div aria-live="polite">
      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
    </div>
  );
}

/** Drafts the next level now, ahead of the hourly job's schedule. */
export function PrepareReminderButton({ invoiceId, label }: { invoiceId: string; label: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<DunningActionState>({ ok: false });
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => start(async () => setState(await prepareReminderAction(invoiceId)))}
        className="justify-self-start"
      >
        <BellRing aria-hidden className="size-4" />
        {pending ? "Wird vorbereitet …" : `${label} vorbereiten`}
      </Button>
      <Status state={state} />
    </div>
  );
}

/** Sets the draft aside; the level waits one payment deadline before the job drafts it again. */
export function DiscardReminderButton({
  reminderId,
  deadlineDays,
}: {
  reminderId: string;
  deadlineDays: number;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<DunningActionState>({ ok: false });
  return (
    <div className="grid gap-2">
      <p className="text-sm text-foreground-muted">
        Hat der Kunde etwa eine Zahlung zugesagt? Verwerfen pausiert diese Stufe für {deadlineDays}{" "}
        Tage.
      </p>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => start(async () => setState(await discardReminderAction(reminderId)))}
        className="justify-self-start"
      >
        {pending ? "Wird verworfen …" : "Entwurf verwerfen"}
      </Button>
      <Status state={state} />
    </div>
  );
}

/**
 * Sends the waiting reminder with the invoice PDF attached. Like the invoice
 * mail, the PDF is rendered here only when none is stored yet (ADR-0037).
 */
export function SendReminder({
  invoiceId,
  reminderId,
  label,
  filename,
  pdfStored,
  claimKey,
  draft,
}: {
  invoiceId: string;
  reminderId: string;
  claimKey: string;
  label: string;
  filename: string;
  pdfStored: boolean;
  draft: { to: string; subject: string; body: string };
}) {
  const [state, setState] = useState<DunningActionState>({ ok: false });
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
        setState(await sendReminderAction(formData));
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
      <input type="hidden" name="reminderId" value={reminderId} />
      <input type="hidden" name="claimKey" value={claimKey} />
      <Field label="An" error={e("to")}>
        <Input name="to" type="email" required defaultValue={draft.to} autoComplete="off" />
      </Field>
      <Field label="Betreff" error={e("subject")}>
        <Input name="subject" required maxLength={200} defaultValue={draft.subject} />
      </Field>
      <Field
        label="Text"
        hint={`Die Rechnung ${filename} hängt an; der Link führt zur Rechnungsseite.`}
        error={e("body")}
      >
        <Textarea name="body" rows={14} required maxLength={4000} defaultValue={draft.body} />
      </Field>
      <Button type="submit" disabled={pending} className="justify-self-start">
        <Send aria-hidden />
        {pending ? step || "Wird gesendet …" : `${label} senden`}
      </Button>
      <Status state={state} />
    </form>
  );
}
