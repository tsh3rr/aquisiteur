"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { REPLAY_NOTICE } from "@/domain/tracking/replay";
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
          <p>{REPLAY_NOTICE.title}</p>
          <p className="text-foreground-muted">{REPLAY_NOTICE.body}</p>
          <p className="text-foreground-muted">
            Zwei gleichwertige Knöpfe: „{REPLAY_NOTICE.accept}“ und „{REPLAY_NOTICE.decline}“.
          </p>
        </div>
        <p className="text-sm text-foreground-muted">
          Aufgezeichnet wird nur nach einem „Ja“. Eingaben in Feldern, der Chat und das
          Rückrufformular bleiben verborgen. Aufzeichnungen werden nach {retentionDays} Tagen
          gelöscht, bei Widerruf sofort.
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
