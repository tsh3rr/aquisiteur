"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { CampaignFormState } from "./actions";

/** Create or edit a campaign: name, note, archived. */
export function CampaignForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: CampaignFormState, form: FormData) => Promise<CampaignFormState>;
  initial?: { name: string; description: string | null; archived: boolean };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  return (
    <form action={formAction} className="grid gap-4">
      <Field label="Name" error={state.errors?.name}>
        <Input
          name="name"
          required
          maxLength={120}
          defaultValue={initial?.name ?? ""}
          placeholder="z. B. Friseure Leipzig, Herbst"
        />
      </Field>
      <Field label="Notiz" optional error={state.errors?.description}>
        <Textarea name="description" maxLength={1000} defaultValue={initial?.description ?? ""} />
      </Field>
      {initial ? (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="archived"
            defaultChecked={initial.archived}
            className="size-5 accent-accent"
          />
          Archiviert (erscheint nicht mehr in den Auswahllisten)
        </label>
      ) : null}
      <div aria-live="polite">
        {state.message ? (
          <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>
        ) : null}
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Speichert …" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
