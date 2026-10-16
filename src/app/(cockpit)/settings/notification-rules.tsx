"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  CHANNEL_LABELS,
  describeRule,
  NOTIFICATION_TRIGGERS,
  TRIGGER_LABELS,
  type NotificationRule,
  type NotificationTrigger,
} from "@/domain/notifications";
import {
  deleteRuleAction,
  saveRuleAction,
  toggleRuleAction,
  type FormState,
} from "./notification-actions";

const selectClass =
  "h-11 w-full rounded-md border border-border bg-surface px-3 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function RuleForm({
  rule,
  onDone,
}: {
  rule?: NotificationRule;
  onDone: (message: string) => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveRuleAction, {
    ok: false,
  });
  const [trigger, setTrigger] = useState<NotificationTrigger>(rule?.trigger ?? "first_visit");
  const e = (name: string) => state.errors?.[name];

  useEffect(() => {
    if (state.ok && state.message) onDone(state.message);
  }, [state, onDone]);

  return (
    <form
      action={action}
      className="grid gap-4 rounded-lg border border-border bg-surface-sunken/40 p-4"
      aria-label={rule ? "Regel bearbeiten" : "Neue Regel"}
    >
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ereignis" error={e("trigger")}>
          <select
            name="trigger"
            value={trigger}
            onChange={(event) => setTrigger(event.target.value as NotificationTrigger)}
            className={selectClass}
          >
            {NOTIFICATION_TRIGGERS.map((value) => (
              <option key={value} value={value}>
                {TRIGGER_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        {trigger === "score_threshold" ? (
          <Field label="Schwelle in %" error={e("threshold")}>
            <Input
              name="threshold"
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              defaultValue={rule?.threshold ?? 50}
            />
          </Field>
        ) : trigger === "daily_digest" ? (
          <Field label="Uhrzeit (volle Stunde)" error={e("threshold")}>
            <Input
              name="threshold"
              type="number"
              min={0}
              max={23}
              inputMode="numeric"
              defaultValue={rule?.threshold ?? 8}
            />
          </Field>
        ) : null}
      </div>
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">Kanäle</legend>
        <div className="flex flex-wrap gap-4">
          {(["push", "email"] as const).map((channel) => (
            <label key={channel} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="channels"
                value={channel}
                defaultChecked={rule ? rule.channels.includes(channel) : channel === "push"}
                className="size-5 accent-accent"
              />
              {CHANNEL_LABELS[channel]}
            </label>
          ))}
        </div>
        {e("channels") ? <p className="text-sm font-medium text-danger">{e("channels")}</p> : null}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ruhezeit von" optional hint="z. B. 22:00" error={e("quietFrom")}>
          <Input name="quietFrom" type="time" defaultValue={rule?.quietFrom ?? ""} />
        </Field>
        <Field label="Ruhezeit bis" optional hint="z. B. 07:00" error={e("quietTo")}>
          <Input name="quietTo" type="time" defaultValue={rule?.quietTo ?? ""} />
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="weekdaysOnly"
          defaultChecked={rule?.weekdaysOnly ?? false}
          className="size-5 accent-accent"
        />
        Nur werktags (Montag bis Freitag)
      </label>
      <p className="-mt-2 text-sm text-foreground-muted">
        In der Ruhezeit und am Wochenende landet die Benachrichtigung nur im Cockpit.
      </p>
      {state.message && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Wird gespeichert …" : rule ? "Regel speichern" : "Regel hinzufügen"}
        </Button>
        <Button variant="ghost" onClick={() => onDone("")} disabled={pending}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}

/** Settings → Benachrichtigungen: Ereignis → Kanal → Bedingung (§7.7). */
export function NotificationRules({
  rules,
  canEdit,
}: {
  rules: NotificationRule[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();

  const done = (message: string) => {
    setEditing(null);
    setStatus(message);
  };

  return (
    <div className="grid gap-4">
      {rules.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          Keine Regeln: Sie sehen Ereignisse nur im Cockpit.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rules.map((rule) => (
            <li key={rule.id} className="grid gap-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    disabled={!canEdit || pending}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      startTransition(async () => {
                        await toggleRuleAction(rule.id, enabled);
                        setStatus(enabled ? "Regel eingeschaltet." : "Regel ausgeschaltet.");
                      });
                    }}
                    className="size-5 accent-accent"
                  />
                  <span className={rule.enabled ? "font-medium" : "text-foreground-muted"}>
                    {describeRule(rule)}
                    {rule.enabled ? null : " · aus"}
                  </span>
                </label>
                {canEdit ? (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(rule.id)}
                      aria-label={`${TRIGGER_LABELS[rule.trigger]} bearbeiten`}
                    >
                      <Pencil aria-hidden />
                      Bearbeiten
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          await deleteRuleAction(rule.id);
                          setStatus("Regel gelöscht.");
                        })
                      }
                      aria-label={`${TRIGGER_LABELS[rule.trigger]} löschen`}
                    >
                      <Trash2 aria-hidden />
                      Löschen
                    </Button>
                  </div>
                ) : null}
              </div>
              {editing === rule.id ? <RuleForm rule={rule} onDone={done} /> : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        editing === "new" ? (
          <RuleForm onDone={done} />
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setEditing("new")}>
              <Plus aria-hidden />
              Regel hinzufügen
            </Button>
          </div>
        )
      ) : null}
      <p aria-live="polite" className="text-sm text-foreground-muted">
        {status}
      </p>
    </div>
  );
}
