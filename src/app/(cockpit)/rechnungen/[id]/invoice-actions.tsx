"use client";

import { Ban, Plus } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  addPaymentAction,
  cancelInvoiceAction,
  type InvoiceActionResult,
  type PaymentState,
} from "../actions";

/** Records a payment, partial payments included. */
export function PaymentForm({
  invoiceId,
  openCents,
  today,
}: {
  invoiceId: string;
  openCents: number;
  today: string;
}) {
  const [state, action, pending] = useActionState<PaymentState, FormData>(addPaymentAction, {
    ok: false,
  });
  const e = (name: string) => state.errors?.[name] || undefined;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Field label="Betrag in €" error={e("amount")}>
        <Input
          name="amount"
          inputMode="decimal"
          required
          defaultValue={(openCents / 100).toFixed(2).replace(".", ",")}
          key={openCents}
        />
      </Field>
      <Field label="Eingegangen am" error={e("paidOn")}>
        <Input name="paidOn" type="date" required defaultValue={today} max={today} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending} className="self-end">
        <Plus aria-hidden />
        {pending ? "Wird erfasst …" : "Zahlung erfassen"}
      </Button>
      <Field label="Notiz" optional className="sm:col-span-3">
        <Input name="note" maxLength={200} />
      </Field>
      <p
        aria-live="polite"
        className={state.ok ? "text-sm text-foreground-muted" : "text-sm text-danger"}
      >
        {state.message}
      </p>
    </form>
  );
}

/** Storno with a confirmation step; the cancellation gets its own number. */
export function CancelInvoice({ invoiceId, number }: { invoiceId: string; number: string }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<InvoiceActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-3">
      {confirming ? (
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <p className="text-sm">
            {number} wird mit einer Stornorechnung mit eigener Nummer aufgehoben. Beide bleiben
            gespeichert. Danach können Sie eine neue, richtige Rechnung anlegen.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setResult(await cancelInvoiceAction(invoiceId));
                  setConfirming(false);
                })
              }
            >
              <Ban aria-hidden />
              {pending ? "Wird storniert …" : "Jetzt stornieren"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          className="justify-self-start"
          onClick={() => setConfirming(true)}
        >
          <Ban aria-hidden />
          Stornieren …
        </Button>
      )}
      <div aria-live="polite">
        {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      </div>
    </div>
  );
}
