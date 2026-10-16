"use client";

import { Download } from "lucide-react";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { deleteWorkspaceAction, saveRetentionAction, type DataSettingsState } from "./data-actions";

const initial: DataSettingsState = { ok: false };

/** Settings → Daten: retention periods (§9). */
export function RetentionForm({
  retention,
  canEdit,
}: {
  retention: { eventsDays: number; replaysDays: number; optOutTrackingDays: number };
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveRetentionAction, initial);
  const e = (name: string) => state.errors?.[name];
  return (
    <form action={action} className="grid gap-4">
      <fieldset className="grid gap-4 sm:grid-cols-3" disabled={!canEdit || pending}>
        <legend className="sr-only">Aufbewahrungsfristen</legend>
        <Field
          label="Ereignisse (Tage)"
          hint="Scrollen, Klicks, Lesezeit je Abschnitt. Standard 365."
          error={e("eventsDays")}
        >
          <Input
            name="eventsDays"
            type="number"
            min={30}
            max={3650}
            inputMode="numeric"
            defaultValue={retention.eventsDays}
          />
        </Field>
        <Field
          label="Aufzeichnungen (Tage)"
          hint="Sitzungsaufzeichnungen mit Einwilligung. Standard 90."
          error={e("replaysDays")}
        >
          <Input
            name="replaysDays"
            type="number"
            min={7}
            max={365}
            inputMode="numeric"
            defaultValue={retention.replaysDays}
          />
        </Field>
        <Field
          label="Nach Sperrvermerk (Tage)"
          hint="Dann werden die Besuchsdaten gelöscht, der Vermerk bleibt. Standard 30."
          error={e("optOutTrackingDays")}
        >
          <Input
            name="optOutTrackingDays"
            type="number"
            min={1}
            max={90}
            inputMode="numeric"
            defaultValue={retention.optOutTrackingDays}
          />
        </Field>
      </fieldset>
      <div aria-live="polite">
        {state.message ? (
          <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>
        ) : null}
      </div>
      <div>
        <Button type="submit" disabled={!canEdit || pending}>
          {pending ? "Speichert …" : "Fristen speichern"}
        </Button>
      </div>
    </form>
  );
}

/** Settings → Daten: export and delete the whole workspace (§9a), owners only. */
export function WorkspaceDataActions({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(deleteWorkspaceAction, initial);
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <a
          href="/settings/export"
          download
          className="inline-flex h-11 items-center gap-2 justify-self-start rounded-md border border-border bg-surface px-3 text-sm font-medium shadow-sm hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <Download aria-hidden className="size-4" />
          Alle Daten exportieren
        </a>
        <p className="text-sm text-foreground-muted">
          Der ganze Workspace als JSON-Datei: Kunden, Exposés, Besuche, Chats, Briefe,
          Einstellungen. API-Schlüssel und Zugangsdaten sind nicht enthalten.
        </p>
      </div>
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-danger">
          Workspace löschen …
        </summary>
        <form action={action} className="mt-3 grid gap-3">
          <p className="text-sm">
            Löscht den Workspace mit allen Kunden, Exposés, Bildern, Besuchen, Aufzeichnungen und
            Chats. Das lässt sich nicht rückgängig machen. Exportieren Sie vorher, was Sie behalten
            möchten.
          </p>
          <Field label={`Zur Bestätigung „${slug}“ eingeben`} error={state.errors?.confirm}>
            <Input name="confirm" autoComplete="off" spellCheck={false} />
          </Field>
          <div aria-live="polite">
            {state.message && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}
          </div>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 items-center justify-self-start rounded-md bg-danger px-4 text-sm font-medium text-danger-foreground hover:bg-danger-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60"
          >
            {pending ? "Löscht …" : "Workspace endgültig löschen"}
          </button>
        </form>
      </details>
    </div>
  );
}
