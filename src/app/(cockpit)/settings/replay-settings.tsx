"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CONSENT_NOTICE } from "@/domain/tracking/consent";
import { saveReplaySettings, type ReplaySettingsState } from "./replay-actions";

export function ReplaySettingsForm({
  enabled,
  retentionDays,
  canEdit,
}: {
  enabled: boolean;
  retentionDays: number;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<ReplaySettingsState, FormData>(
    saveReplaySettings,
    { ok: false },
  );
  return (
    <form action={action} className="grid gap-4">
      <fieldset disabled={!canEdit || pending} className="grid gap-4">
        <legend className="sr-only">Sitzungsaufzeichnung</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={enabled}
            className="size-5 accent-accent"
          />
          Besucher im Exposé um Erlaubnis für eine Aufzeichnung bitten
        </label>
        <div className="grid gap-1 rounded-md border border-border bg-surface-sunken p-4 text-sm">
          <p className="font-medium">So sieht der Hinweis aus:</p>
          <p>{CONSENT_NOTICE.title}</p>
          <p className="text-foreground-muted">{CONSENT_NOTICE.body("Café Müller")}</p>
          <p className="text-foreground-muted">
            {`Drei gleichwertige Knöpfe: „${CONSENT_NOTICE.reject}“, „${CONSENT_NOTICE.choose}“ und „${CONSENT_NOTICE.accept}“. Unter „${CONSENT_NOTICE.choose}“ stehen die Schalter „${CONSENT_NOTICE.statistics.label}“ und, wenn hier eingeschaltet, „${CONSENT_NOTICE.replay.label}“, beide anfangs aus.`}
          </p>
        </div>
        <p className="text-sm text-foreground-muted">
          Der Hinweis erscheint in jedem Exposé, weil auch die Lesestatistik eine Zustimmung
          braucht. Aufgezeichnet wird nur, wenn der Besucher „{CONSENT_NOTICE.replay.label}“
          einschaltet. Eingaben in Feldern, der Chat und das Rückrufformular bleiben verborgen.
          Aufzeichnungen werden nach {retentionDays} Tagen gelöscht, bei Widerruf sofort.
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
