"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DEFAULT_WEIGHTS, SIGNAL_LABELS, type WeightedSignalId } from "@/domain/intent/score";
import { saveScoreSettingsAction, type FormState } from "./notification-actions";

/** Settings → Kontaktabsicht: the weights of the signals (§7.6) and the time zone. */
export function ScoreSettingsForm({
  weights,
  timezone,
  canEdit,
}: {
  weights: Record<WeightedSignalId, number>;
  timezone: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveScoreSettingsAction, {
    ok: false,
  });
  const e = (name: string) => state.errors?.[name];
  const ids = Object.keys(DEFAULT_WEIGHTS) as WeightedSignalId[];

  return (
    <form action={action} className="grid gap-6">
      <fieldset className="grid gap-4" disabled={!canEdit || pending}>
        <legend className="mb-2 text-base font-semibold">Gewichtung der Signale</legend>
        <p className="-mt-2 text-sm text-foreground-muted">
          Wie stark ein Signal allein für einen Kontaktversuch spricht, in Prozent. Mehrere Signale
          ergänzen sich; 100 % gibt es nur bei einer gesendeten Nachricht oder einem Rückrufwunsch.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {ids.map((id) => (
            <Field
              key={id}
              label={SIGNAL_LABELS[id]}
              hint={`Standard: ${Math.round(DEFAULT_WEIGHTS[id] * 100)} %`}
              error={e(`weight.${id}`)}
            >
              <Input
                name={`weight.${id}`}
                type="number"
                min={0}
                max={99}
                inputMode="numeric"
                defaultValue={Math.round(weights[id] * 100)}
              />
            </Field>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-4" disabled={!canEdit || pending}>
        <legend className="mb-2 text-base font-semibold">Zeitzone</legend>
        <Field
          label="Zeitzone"
          hint="Für Ruhezeiten, Werktage, die Tageszusammenfassung und „am besten vormittags“."
          error={e("timezone")}
        >
          <Input name="timezone" defaultValue={timezone} autoComplete="off" />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={!canEdit || pending}>
          {pending ? "Wird gespeichert …" : "Speichern und neu berechnen"}
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
