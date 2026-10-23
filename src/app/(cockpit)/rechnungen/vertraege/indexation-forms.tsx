"use client";

import { Clock, Send, Trash2, Undo2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  formatChange,
  formatIndex,
  INDEX_EMAIL_BODY,
  INDEX_EMAIL_SUBJECT,
  MONTH_NAMES,
  monthLabel,
  parseIndex,
  planAdjustment,
} from "@/domain/invoices/indexation";
import { INTERVAL_PERIOD_LABELS, type ContractInterval } from "@/domain/invoices/maintenance";
import type { InvoiceLine } from "@/domain/invoices/schema";
import { germanDate } from "@/domain/invoices/totals";
import { formatCents } from "@/domain/offers/totals";
import {
  addTimeEntryAction,
  announceAdjustmentAction,
  deleteTimeEntryAction,
  saveIndexationAction,
  saveQuotaAction,
  withdrawAdjustmentAction,
  type ContractActionState,
} from "./actions";

/** Wertsicherung and Stundenkontingent on the contract page (§7.10, phase 7c-3b). */

function Status({ state }: { state: ContractActionState }) {
  return (
    <div aria-live="polite">
      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
    </div>
  );
}

export function IndexationSettingsForm({
  contractId,
  indexed,
  indexMonth,
  baseMonth,
  baseTenths,
  thresholdPercent,
  baseLocked,
}: {
  contractId: string;
  indexed: boolean;
  indexMonth: number;
  baseMonth: string | null;
  baseTenths: number | null;
  thresholdPercent: number;
  baseLocked: boolean;
}) {
  const [state, action, pending] = useActionState(saveIndexationAction, { ok: false });
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="contractId" value={contractId} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="indexed"
          className="size-5 accent-accent"
          defaultChecked={indexed}
        />
        Preise nach dem VPI 2020 wertsichern
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Anpassung jährlich im">
          <Select name="indexMonth" defaultValue={String(indexMonth)}>
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Schwellenwert in %"
          hint="Kleinere Änderungen bleiben unberücksichtigt und summieren sich."
        >
          <Input
            type="number"
            name="thresholdPercent"
            min={0}
            max={10}
            defaultValue={thresholdPercent}
          />
        </Field>
        {baseLocked ? (
          <>
            <input type="hidden" name="baseMonth" value={baseMonth ?? ""} />
            <input
              type="hidden"
              name="baseValue"
              value={baseTenths ? formatIndex(baseTenths) : ""}
            />
          </>
        ) : null}
        <Field
          label="Basis: Monat"
          hint={baseLocked ? "Fest, solange eine Anpassung angekündigt ist." : "Als JJJJ-MM."}
        >
          <Input
            type="month"
            name={baseLocked ? undefined : "baseMonth"}
            defaultValue={baseMonth ?? ""}
            disabled={baseLocked}
            placeholder="2026-09"
          />
        </Field>
        <Field label="Basis: Indexwert" hint="Wie veröffentlicht, z. B. 128,7.">
          <Input
            name={baseLocked ? undefined : "baseValue"}
            inputMode="decimal"
            defaultValue={baseTenths ? formatIndex(baseTenths) : ""}
            disabled={baseLocked}
          />
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? "Wird gespeichert …" : "Speichern"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function AnnounceAdjustmentForm({
  contractId,
  lines,
  interval,
  baseMonth,
  baseTenths,
  thresholdPercent,
  dueOn,
  today,
  noticeDays,
  billedUntil,
  recipient,
}: {
  contractId: string;
  lines: InvoiceLine[];
  interval: ContractInterval;
  baseMonth: string;
  baseTenths: number;
  thresholdPercent: number;
  dueOn: string;
  today: string;
  noticeDays: number;
  billedUntil: string | null;
  recipient: string;
}) {
  const [state, action, pending] = useActionState(announceAdjustmentAction, { ok: false });
  const [month, setMonth] = useState("");
  const [value, setValue] = useState("");
  const tenths = parseIndex(value);
  const valid = tenths !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month > baseMonth;
  const plan = valid
    ? planAdjustment({
        lines,
        interval,
        baseTenths,
        indexTenths: tenths,
        thresholdPercent,
        dueOn,
        today,
        noticeDays,
        billedUntil,
      })
    : null;
  const per = INTERVAL_PERIOD_LABELS[interval];
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="contractId" value={contractId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Indexmonat" hint="Der zuletzt veröffentlichte Monat, als JJJJ-MM.">
          <Input
            type="month"
            name="indexMonth"
            required
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            placeholder="2026-10"
          />
        </Field>
        <Field
          label="Indexwert"
          hint={`Basis ${formatIndex(baseTenths)} (${monthLabel(baseMonth)})`}
        >
          <Input
            name="indexValue"
            inputMode="decimal"
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
      </div>
      <div aria-live="polite" className="grid gap-2 text-sm">
        {plan ? (
          plan.within ? (
            <p>
              Änderung {formatChange(plan.changePercent)}: innerhalb des Schwellenwerts von{" "}
              {thresholdPercent} %. Die Preise bleiben, die Basis auch.
            </p>
          ) : (
            <>
              <p>
                Änderung {formatChange(plan.changePercent)}. Neue Preise ab{" "}
                <strong>{germanDate(plan.effectiveFrom)}</strong>:
              </p>
              <ul className="grid gap-1">
                {plan.newLines.map((line, index) => (
                  <li key={line.id} className="flex flex-wrap justify-between gap-2">
                    <span>{line.title}</span>
                    <span className="tabular-nums">
                      {formatCents(lines[index]?.unitPriceCents ?? 0)} →{" "}
                      {formatCents(line.unitPriceCents)} pro {per}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : month && value ? (
          <p className="text-foreground-muted">
            Bitte einen Monat nach {monthLabel(baseMonth)} und einen Wert wie 132,6 angeben.
          </p>
        ) : null}
      </div>
      {plan && !plan.within ? (
        <>
          <Field label="An">
            <Input type="email" name="to" required defaultValue={recipient} />
          </Field>
          <Field label="Betreff">
            <Input name="subject" required defaultValue={INDEX_EMAIL_SUBJECT} maxLength={200} />
          </Field>
          <Field
            label="Text"
            hint="Platzhalter wie {ab} und {aufstellung} werden beim Senden ausgefüllt."
          >
            <Textarea name="body" required rows={10} defaultValue={INDEX_EMAIL_BODY} />
          </Field>
        </>
      ) : null}
      <Button type="submit" disabled={pending || !plan} className="justify-self-start">
        <Send aria-hidden className="size-4" />
        {pending
          ? "Wird gesendet …"
          : plan?.within
            ? "Ohne Anpassung festhalten"
            : "Ankündigen und senden"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function WithdrawAdjustmentButton({
  contractId,
  adjustmentId,
}: {
  contractId: string;
  adjustmentId: string;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ContractActionState>({ ok: false });
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        className="justify-self-start"
        onClick={() =>
          start(async () => setState(await withdrawAdjustmentAction(contractId, adjustmentId)))
        }
      >
        <Undo2 aria-hidden className="size-4" />
        {pending ? "Wird zurückgezogen …" : "Ankündigung zurückziehen"}
      </Button>
      <Status state={state} />
    </div>
  );
}

export function QuotaForm({
  contractId,
  includedMinutes,
  hourlyRateCents,
  interval,
}: {
  contractId: string;
  includedMinutes: number;
  hourlyRateCents: number | null;
  interval: ContractInterval;
}) {
  const [state, action, pending] = useActionState(saveQuotaAction, { ok: false });
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="contractId" value={contractId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Enthaltene Stunden pro ${INTERVAL_PERIOD_LABELS[interval]}`}>
          <Input
            name="includedHours"
            inputMode="decimal"
            defaultValue={String(includedMinutes / 60).replace(".", ",")}
          />
        </Field>
        <Field label="Stundensatz in € (netto)" hint="Leer: Mehrstunden werden nicht berechnet.">
          <Input
            name="hourlyRate"
            inputMode="decimal"
            defaultValue={
              hourlyRateCents ? (hourlyRateCents / 100).toFixed(2).replace(".", ",") : ""
            }
          />
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? "Wird gespeichert …" : "Speichern"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function TimeEntryForm({ contractId, today }: { contractId: string; today: string }) {
  const [state, action, pending] = useActionState(addTimeEntryAction, { ok: false });
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="contractId" value={contractId} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label="Datum">
          <Input type="date" name="workDate" required defaultValue={today} />
        </Field>
        <Field label="Dauer" hint="1,5 oder 1:30">
          <Input name="duration" required inputMode="decimal" />
        </Field>
        <Field label="Tätigkeit" className="sm:col-span-2">
          <Input name="description" required maxLength={200} />
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        <Clock aria-hidden className="size-4" />
        {pending ? "Wird erfasst …" : "Zeit erfassen"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function DeleteTimeEntryButton({
  contractId,
  entryId,
  label,
}: {
  contractId: string;
  entryId: string;
  label: string;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ContractActionState>({ ok: false });
  return (
    <div className="grid justify-items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label={`Eintrag löschen: ${label}`}
        onClick={() =>
          start(async () => setState(await deleteTimeEntryAction(contractId, entryId)))
        }
      >
        <Trash2 aria-hidden className="size-4" />
      </Button>
      {state.ok ? null : <Status state={state} />}
    </div>
  );
}
