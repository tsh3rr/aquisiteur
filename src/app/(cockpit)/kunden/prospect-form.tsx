"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { FormState } from "./actions";

export interface ProspectValues {
  id?: string;
  companyName: string;
  industry: string | null;
  website: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  tags: string[];
  estimatedValueCents: number | null;
  campaignId: string | null;
}

export const EMPTY_PROSPECT: ProspectValues = {
  companyName: "",
  industry: null,
  website: null,
  street: null,
  postalCode: null,
  city: null,
  phone: null,
  email: null,
  notes: null,
  tags: [],
  estimatedValueCents: null,
  campaignId: null,
};

/** Master data of a prospect (§7.1), for „Neuer Kunde“ and the detail page. */
export function ProspectForm({
  action,
  values,
  submitLabel,
  campaigns,
  compact = false,
}: {
  campaigns: { id: string; name: string }[];
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  values: ProspectValues;
  submitLabel: string;
  /** One column, for the narrow side column of the detail page. */
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  const errors = state.errors ?? {};
  const text = (value: string | null) => value ?? "";

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className={compact ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"}>
        <Field
          label="Firma"
          error={errors.companyName}
          className={compact ? undefined : "sm:col-span-2"}
        >
          <Input
            name="companyName"
            required
            maxLength={200}
            defaultValue={values.companyName}
            autoComplete="organization"
          />
        </Field>
        <Field label="Branche" optional error={errors.industry}>
          <Input name="industry" defaultValue={text(values.industry)} maxLength={100} />
        </Field>
        <Field label="Website" optional error={errors.website}>
          <Input
            name="website"
            type="url"
            defaultValue={text(values.website)}
            placeholder="https://"
          />
        </Field>
        <Field label="Straße und Hausnummer" optional error={errors.street}>
          <Input name="street" defaultValue={text(values.street)} autoComplete="street-address" />
        </Field>
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field label="PLZ" optional error={errors.postalCode}>
            <Input
              name="postalCode"
              defaultValue={text(values.postalCode)}
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </Field>
          <Field label="Ort" optional error={errors.city}>
            <Input name="city" defaultValue={text(values.city)} autoComplete="address-level2" />
          </Field>
        </div>
        <Field label="Telefon" optional error={errors.phone}>
          <Input name="phone" type="tel" defaultValue={text(values.phone)} />
        </Field>
        <Field label="E-Mail" optional error={errors.email}>
          <Input name="email" type="email" defaultValue={text(values.email)} />
        </Field>
        <Field
          label="Tags"
          optional
          hint="Mit Komma getrennt, z. B. café, leipzig"
          error={errors.tags}
        >
          <Input name="tags" defaultValue={values.tags.join(", ")} />
        </Field>
        <Field label="Geschätzter Auftragswert in Euro" optional error={errors.estimatedValue}>
          <Input
            name="estimatedValue"
            inputMode="decimal"
            defaultValue={
              values.estimatedValueCents === null
                ? ""
                : String(values.estimatedValueCents / 100).replace(".", ",")
            }
          />
        </Field>
        <Field label="Kampagne" optional error={errors.campaignId}>
          <Select name="campaignId" defaultValue={values.campaignId ?? ""}>
            <option value="">Keine</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Notizen"
          optional
          hint="Markdown möglich"
          error={errors.notes}
          className={compact ? undefined : "sm:col-span-2"}
        >
          <Textarea name="notes" rows={5} defaultValue={text(values.notes)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Wird gespeichert …" : submitLabel}
        </Button>
        <p
          aria-live="polite"
          className={state.ok ? "text-sm text-foreground-muted" : "text-sm text-danger"}
        >
          {state.message ??
            (Object.keys(errors).length > 0 ? "Bitte prüfen Sie die markierten Felder." : "")}
        </p>
      </div>
    </form>
  );
}
