"use client";

import { useActionState, useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createLettersAction, type CreateState } from "../actions";

const radio = "size-5 accent-accent";

export function NewLettersForm({ ids, kind }: { ids: string[]; kind: "initial" | "follow_up" }) {
  const [state, action, pending] = useActionState<CreateState, FormData>(createLettersAction, {
    ok: false,
  });
  const teaserId = useId();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Art des Briefs</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-5">
          <input type="hidden" name="ids" value={ids.join(",")} />
          <fieldset className="grid gap-1">
            <legend className="sr-only">Art des Briefs</legend>
            <label className="grid min-h-11 grid-cols-[auto_1fr] items-start gap-x-3 text-sm">
              <input
                type="radio"
                name="kind"
                value="initial"
                defaultChecked={kind === "initial"}
                className={radio}
              />
              <span className="font-medium">Erster Brief</span>
              <span className="col-start-2 text-foreground-muted">
                Text aus dem Exposé, sonst aus der Vorlage in den Einstellungen. Nutzt den Code des
                Exposés.
              </span>
            </label>
            <label className="grid min-h-11 grid-cols-[auto_1fr] items-start gap-x-3 text-sm">
              <input
                type="radio"
                name="kind"
                value="follow_up"
                defaultChecked={kind === "follow_up"}
                className={radio}
              />
              <span className="font-medium">Folgebrief</span>
              <span className="col-start-2 text-foreground-muted">
                Bekommt einen eigenen Code, damit Sie sehen, welcher Brief gewirkt hat.
              </span>
            </label>
          </fieldset>
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">Druck</legend>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 text-sm">
              <input
                id={teaserId}
                type="checkbox"
                name="teaser"
                defaultChecked
                aria-describedby={`${teaserId}-hint`}
                className={radio}
              />
              <label htmlFor={teaserId} className="flex min-h-11 items-center font-medium">
                Exposé-Vorschau als zweite Seite
              </label>
              <p id={`${teaserId}-hint`} className="col-start-2 -mt-2 mb-1 text-foreground-muted">
                Titelbild, Überschrift und die drei wichtigsten Ideen aus dem Exposé, in seinen
                Farben. Wirkt am besten im Farbdruck.
              </p>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" name="color" className={radio} />
              Farbdruck
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" name="duplex" className={radio} />
              Beidseitig
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || ids.length === 0}>
              {pending
                ? "Wird erstellt …"
                : `${ids.length} ${ids.length === 1 ? "Brief" : "Briefe"} erstellen`}
            </Button>
          </div>
          <div aria-live="polite">
            {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
