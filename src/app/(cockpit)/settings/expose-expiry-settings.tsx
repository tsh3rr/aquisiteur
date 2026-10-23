"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveExposeExpiry, type ExposeExpiryState } from "./expose-expiry-actions";

const initial: ExposeExpiryState = { ok: false };

/** Settings → Exposés: expiry after quiet days (§7.3). */
export function ExposeExpiryForm({
  enabled,
  afterDays,
  canEdit,
}: {
  enabled: boolean;
  afterDays: number;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveExposeExpiry, initial);
  return (
    <form action={action} className="grid gap-4">
      <fieldset disabled={!canEdit || pending} className="grid gap-4">
        <legend className="sr-only">Ablauf von Exposés</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={enabled}
            className="size-5 accent-accent"
          />
          Exposés ohne Aufruf automatisch auf eine Kurzseite umstellen
        </label>
        <Field
          label="Nach wie vielen Tagen ohne Aufruf"
          hint="Gezählt ab dem letzten Besuch, dem letzten verschickten Brief oder dem Veröffentlichen einer neuen Version. Standard 60."
          error={state.errors?.afterDays}
        >
          <Input
            name="afterDays"
            type="number"
            min={7}
            max={365}
            inputMode="numeric"
            defaultValue={afterDays}
            className="max-w-32"
          />
        </Field>
        <p className="text-sm text-foreground-muted">
          Die Kurzseite sagt offen, dass die Ideen schon eine Weile her sind, und bietet einen
          frischen Blick an: Vorher-nachher-Slider, Ihre Ideen nur als Stichpunkte, dann alle
          Kontaktwege. Besuche der Kurzseite melden sich wie gewohnt, stellen das Exposé aber nicht
          wieder her. Das geht mit „Wieder voll anzeigen“ beim Exposé.
        </p>
      </fieldset>
      <div aria-live="polite">
        {state.message ? (
          <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>
        ) : null}
      </div>
      <div>
        <Button type="submit" disabled={!canEdit || pending}>
          {pending ? "Speichert …" : "Speichern"}
        </Button>
      </div>
    </form>
  );
}
