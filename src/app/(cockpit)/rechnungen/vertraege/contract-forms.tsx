"use client";

import { CalendarClock, Repeat } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import {
  INVOICE_SEND_MODES,
  INVOICE_SEND_MODE_LABELS,
  type InvoiceSendMode,
} from "@/domain/invoices/email";
import {
  createContractsAction,
  saveContractAction,
  setContractEndAction,
  type ContractActionState,
} from "./actions";

function Status({ state }: { state: ContractActionState }) {
  return (
    <div aria-live="polite">
      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
    </div>
  );
}

/** Accepted offer → one maintenance contract per recurring interval (§7.10). */
export function CreateContractsButton({ offerId }: { offerId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ContractActionState>({ ok: false });
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => start(async () => setState(await createContractsAction(offerId)))}
        className="justify-self-start"
      >
        <Repeat aria-hidden className="size-4" />
        {pending ? "Wird angelegt …" : "Wartungsvertrag anlegen"}
      </Button>
      <Status state={state} />
    </div>
  );
}

export function ContractSettingsForm({
  contractId,
  startDate,
  startLocked,
  sendMode,
  workspaceSendMode,
}: {
  contractId: string;
  startDate: string | null;
  startLocked: boolean;
  sendMode: InvoiceSendMode | null;
  workspaceSendMode: InvoiceSendMode;
}) {
  const [state, action, pending] = useActionState(saveContractAction, { ok: false });
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="contractId" value={contractId} />
      {startLocked ? <input type="hidden" name="startDate" value={startDate ?? ""} /> : null}
      <Field
        label="Beginn"
        hint={
          startLocked
            ? "Steht fest, seit die erste Rechnung angelegt ist."
            : "Ab diesem Tag wird abgerechnet; der erste Zeitraum ist anteilig, wenn er nicht am Periodenanfang beginnt. Leer: noch offen, z. B. bis zum Go-live."
        }
      >
        <Input
          type="date"
          name={startLocked ? undefined : "startDate"}
          defaultValue={startDate ?? ""}
          disabled={startLocked}
        />
      </Field>
      <Field label="Versand">
        <Select name="sendMode" defaultValue={sendMode ?? ""}>
          <option value="">
            Wie in den Einstellungen ({INVOICE_SEND_MODE_LABELS[workspaceSendMode]})
          </option>
          {INVOICE_SEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {INVOICE_SEND_MODE_LABELS[mode]}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? "Wird gespeichert …" : "Speichern"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function ContractNoticeForm({
  contractId,
  noticeReceivedOn,
  endDate,
  today,
}: {
  contractId: string;
  noticeReceivedOn: string | null;
  endDate: string | null;
  today: string;
}) {
  const [state, action, pending] = useActionState(setContractEndAction, { ok: false });
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="contractId" value={contractId} />
      <Field label="Kündigung eingegangen am">
        <Input
          type="date"
          name="noticeReceivedOn"
          defaultValue={noticeReceivedOn ?? today}
          required={!noticeReceivedOn}
        />
      </Field>
      <Field
        label="Vertragsende"
        optional
        hint="Leer: der frühestmögliche Termin nach Kündigungsfrist (zum Monatsende) und Mindestlaufzeit. Ein späterer Termin ist möglich."
      >
        <Input type="date" name="endDate" defaultValue={endDate ?? ""} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="notice" disabled={pending}>
          <CalendarClock aria-hidden className="size-4" />
          {noticeReceivedOn ? "Kündigung ändern" : "Kündigung eintragen"}
        </Button>
        {noticeReceivedOn ? (
          <Button
            type="submit"
            name="intent"
            value="withdraw"
            variant="secondary"
            disabled={pending}
            formNoValidate
          >
            Kündigung zurücknehmen
          </Button>
        ) : null}
      </div>
      <Status state={state} />
    </form>
  );
}
