"use client";

import { Plus } from "lucide-react";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from "@/domain/projects";
import { createProjectAction, type ProjectFormState, updateProjectAction } from "./actions";

/** „Neues Projekt“ on the customer page. */
export function CreateProjectForm({ prospectId }: { prospectId: string }) {
  const [state, formAction, pending] = useActionState(createProjectAction, {
    ok: false,
  } as ProjectFormState);
  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="prospectId" value={prospectId} />
      <Field
        label="Neues Projekt"
        hint="Zum Beispiel „Relaunch Website“ oder „Onlineshop“."
        error={state.errors?.name}
      >
        <Input name="name" required maxLength={120} />
      </Field>
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <Button type="submit" variant="secondary" className="justify-self-start" disabled={pending}>
        <Plus aria-hidden />
        Projekt anlegen
      </Button>
    </form>
  );
}

export function EditProjectForm({
  project,
}: {
  project: { id: string; name: string; description: string | null; status: ProjectStatus };
}) {
  const [state, formAction, pending] = useActionState(updateProjectAction, {
    ok: false,
  } as ProjectFormState);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <input type="hidden" name="id" value={project.id} />
      <Field label="Name" error={state.errors?.name}>
        <Input name="name" defaultValue={project.name} required maxLength={120} />
      </Field>
      <Field label="Status" error={state.errors?.status}>
        <Select name="status" defaultValue={project.status}>
          {PROJECT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PROJECT_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Beschreibung" optional error={state.errors?.description}>
        <Textarea name="description" defaultValue={project.description ?? ""} rows={3} />
      </Field>
      <div aria-live="polite">
        {state.message ? (
          <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>
        ) : null}
      </div>
      <Button type="submit" className="justify-self-start" disabled={pending}>
        Speichern
      </Button>
    </form>
  );
}
