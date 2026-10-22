"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import type { BillingProfile } from "@/domain/invoices/schema";
import { saveBillingProfileAction, type BillingProfileState } from "../../rechnungen/actions";

/** Customer → Stammdaten → Rechnungsprofil (§7.10): who the invoices go to. */
export function BillingProfileForm({
  prospectId,
  profile,
  companyName,
  defaultTermsDays,
  canEdit,
}: {
  prospectId: string;
  profile: BillingProfile;
  companyName: string;
  defaultTermsDays: number;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<BillingProfileState, FormData>(
    saveBillingProfileAction,
    { ok: false },
  );
  const e = (name: string) => state.errors?.[name];
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="prospectId" value={prospectId} />
      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={!canEdit || pending}>
        <legend className="sr-only">Rechnungsprofil</legend>
        <Field
          label="Kundenart"
          hint="Unternehmen in der EU mit UID bekommen Rechnungen mit Reverse Charge."
          error={e("customerType")}
          className="sm:col-span-2"
        >
          <Select name="customerType" defaultValue={profile.customerType}>
            <option value="business">Unternehmen</option>
            <option value="consumer">Privatperson</option>
          </Select>
        </Field>
        <Field
          label="Name auf der Rechnung"
          optional
          hint={`Leer: ${companyName}`}
          error={e("name")}
          className="sm:col-span-2"
        >
          <Input name="name" defaultValue={profile.name ?? ""} maxLength={160} />
        </Field>
        <Field
          label="UID-Nummer des Kunden"
          optional
          hint="Pflicht über 10.000 € brutto und für Reverse Charge."
          error={e("vatId")}
        >
          <Input name="vatId" defaultValue={profile.vatId ?? ""} maxLength={20} />
        </Field>
        <Field label="Rechnungs-E-Mail" optional error={e("email")}>
          <Input name="email" type="email" defaultValue={profile.email ?? ""} maxLength={254} />
        </Field>
        <Field
          label="Zahlungsziel in Tagen"
          optional
          hint={`Leer: ${defaultTermsDays} Tage aus den Einstellungen.`}
          error={e("paymentTermsDays")}
        >
          <Input
            name="paymentTermsDays"
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            defaultValue={profile.paymentTermsDays ?? ""}
          />
        </Field>
        <p className="text-sm text-foreground-muted sm:col-span-2">
          Abweichende Rechnungsadresse. Leer lassen, dann gilt die Adresse aus den Stammdaten.
        </p>
        <Field label="Straße und Hausnummer" optional error={e("street")} className="sm:col-span-2">
          <Input name="street" defaultValue={profile.street ?? ""} maxLength={160} />
        </Field>
        <Field label="PLZ" optional error={e("postalCode")}>
          <Input name="postalCode" defaultValue={profile.postalCode ?? ""} maxLength={10} />
        </Field>
        <Field label="Ort" optional error={e("city")}>
          <Input name="city" defaultValue={profile.city ?? ""} maxLength={120} />
        </Field>
        <Field
          label="Land"
          optional
          hint="Ländercode, z. B. AT, DE, CH. Leer: wie in den Stammdaten."
          error={e("country")}
        >
          <Input name="country" defaultValue={profile.country ?? ""} maxLength={2} />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!canEdit || pending}>
          {pending ? "Wird gespeichert …" : "Rechnungsprofil speichern"}
        </Button>
        <p
          aria-live="polite"
          className={state.ok ? "text-sm text-foreground-muted" : "text-sm text-danger"}
        >
          {state.message}
        </p>
      </div>
    </form>
  );
}
