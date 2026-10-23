"use client";

import { Archive } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  SMALL_BUSINESS_NOTE,
  TAX_MODES,
  TAX_MODE_LABELS,
  type BillingSettings,
} from "@/domain/billing";
import {
  INVOICE_EMAIL_PLACEHOLDERS,
  INVOICE_SEND_MODES,
  INVOICE_SEND_MODE_LABELS,
} from "@/domain/invoices/email";
import { DUNNING_MODES, DUNNING_MODE_LABELS } from "@/domain/invoices/dunning";
import { BILLING_INTERVALS, BILLING_LABELS, UNITS, VAT_RATES } from "@/domain/offers/schema";
import { formatCents } from "@/domain/offers/totals";
import {
  addCatalogItem,
  archiveCatalogItem,
  saveBillingSettings,
  type BillingSettingsState,
} from "./billing-actions";

/** Settings → Angebote und Rechnungen (§7.10). */
export function BillingSettingsForm({
  billing,
  canEdit,
}: {
  billing: BillingSettings;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<BillingSettingsState, FormData>(
    saveBillingSettings,
    { ok: false },
  );
  const e = (name: string) => state.errors?.[name];
  const disabled = !canEdit || pending;

  return (
    <form action={action} className="grid gap-8">
      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={disabled}>
        <legend className="mb-3 text-base font-semibold">Steuer</legend>
        <Field
          label="Umsatzsteuer"
          hint="Kleinunternehmer bis 55.000 € Jahresumsatz weisen keine USt aus. Mit der Umstellung zeigen neue Angebote USt je Position."
          error={e("taxMode")}
          className="sm:col-span-2"
        >
          <Select name="taxMode" defaultValue={billing.taxMode}>
            {TAX_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {TAX_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Ihre UID-Nummer"
          optional
          hint="Format ATU12345678. Pflicht auf Rechnungen über 400 €, sobald Sie eine haben."
          error={e("vatId")}
        >
          <Input name="vatId" defaultValue={billing.vatId ?? ""} maxLength={14} />
        </Field>
        <Field
          label="Steuernummer"
          optional
          hint="Vom Finanzamt, z. B. 12 345/6789. Ohne UID kennzeichnet sie Sie in der E-Rechnung."
          error={e("taxNumber")}
        >
          <Input name="taxNumber" defaultValue={billing.taxNumber ?? ""} maxLength={20} />
        </Field>
        <Field
          label="Hinweis für Kleinunternehmer"
          hint="Erscheint unter jedem Angebot und jeder Rechnung ohne USt."
          error={e("smallBusinessNote")}
          className="sm:col-span-2"
        >
          <Textarea
            name="smallBusinessNote"
            rows={2}
            defaultValue={billing.smallBusinessNote}
            placeholder={SMALL_BUSINESS_NOTE}
            maxLength={300}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4" disabled={disabled}>
        <legend className="mb-3 text-base font-semibold">Angebote</legend>
        <Field
          label="Gültigkeit in Tagen"
          hint="Ab dem Versand. Danach kann der Kunde nicht mehr online annehmen."
          error={e("offerValidDays")}
          className="sm:max-w-xs"
        >
          <Input
            name="offerValidDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            defaultValue={billing.offerValidDays}
          />
        </Field>
        <Field label="Einleitung neuer Angebote" error={e("offerIntro")}>
          <Textarea name="offerIntro" rows={3} defaultValue={billing.offerIntro} maxLength={4000} />
        </Field>
        <Field label="Schlusstext neuer Angebote" error={e("offerOutro")}>
          <Textarea name="offerOutro" rows={2} defaultValue={billing.offerOutro} maxLength={4000} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={disabled}>
        <legend className="mb-3 text-base font-semibold">Rechnungen</legend>
        <Field
          label="IBAN"
          optional
          hint="Steht auf jeder Rechnung und im QR-Code „Zahlen mit Code“."
          error={e("iban")}
        >
          <Input name="iban" defaultValue={billing.iban ?? ""} maxLength={42} autoComplete="off" />
        </Field>
        <Field label="BIC" optional error={e("bic")}>
          <Input name="bic" defaultValue={billing.bic ?? ""} maxLength={11} autoComplete="off" />
        </Field>
        <Field label="Bank" optional error={e("bankName")}>
          <Input name="bankName" defaultValue={billing.bankName ?? ""} maxLength={120} />
        </Field>
        <Field
          label="Zahlungsziel in Tagen"
          hint="Ab dem Rechnungsdatum. Im Rechnungsprofil eines Kunden abweichend einstellbar."
          error={e("paymentTermsDays")}
        >
          <Input
            name="paymentTermsDays"
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            defaultValue={billing.paymentTermsDays}
          />
        </Field>
        <Field
          label="Einleitung neuer Rechnungen"
          error={e("invoiceIntro")}
          className="sm:col-span-2"
        >
          <Textarea
            name="invoiceIntro"
            rows={2}
            defaultValue={billing.invoiceIntro}
            maxLength={4000}
          />
        </Field>
        <Field
          label="Schlusstext neuer Rechnungen"
          error={e("invoiceOutro")}
          className="sm:col-span-2"
        >
          <Textarea
            name="invoiceOutro"
            rows={2}
            defaultValue={billing.invoiceOutro}
            maxLength={4000}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4" disabled={disabled}>
        <legend className="mb-3 text-base font-semibold">Versand per E-Mail</legend>
        <Field
          label="Versand"
          hint="Gilt für Wartungsrechnungen, die der stündliche Job vorbereitet; jeder Vertrag kann abweichen. Mit Freigabe entstehen Entwurf und Aufgabe „Rechnung freigeben“, die sich mit dem Versand erledigt. Automatisch gehen nur volle Zeiträume mit denselben Positionen wie die letzte Rechnung hinaus, sonst entsteht die Aufgabe. Rechnungen, die Sie selbst anlegen, senden Sie immer direkt."
          error={e("invoiceSendMode")}
        >
          <Select name="invoiceSendMode" defaultValue={billing.invoiceSendMode}>
            {INVOICE_SEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {INVOICE_SEND_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Betreff" error={e("invoiceEmailSubject")}>
          <Input
            name="invoiceEmailSubject"
            defaultValue={billing.invoiceEmailSubject}
            maxLength={200}
          />
        </Field>
        <Field
          label="Text der E-Mail"
          hint={`Platzhalter: ${INVOICE_EMAIL_PLACEHOLDERS.map((name) => `{${name}}`).join(", ")}. Das PDF hängt immer an.`}
          error={e("invoiceEmailBody")}
        >
          <Textarea
            name="invoiceEmailBody"
            rows={8}
            defaultValue={billing.invoiceEmailBody}
            maxLength={4000}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3" disabled={disabled}>
        <legend className="mb-3 text-base font-semibold">Mahnwesen</legend>
        <Field
          label="Erinnerungen und Mahnungen"
          hint="Der stündliche Job bereitet jede fällige Stufe als Entwurf vor. Mit Freigabe entsteht eine Aufgabe, die sich mit dem Versand erledigt; automatisch geht sie sofort per E-Mail mit der Rechnung im Anhang hinaus. Bezahlt der Kunde, verschwindet ein wartender Entwurf."
          error={e("dunningMode")}
          className="sm:col-span-3"
        >
          <Select name="dunningMode" defaultValue={billing.dunningMode}>
            {DUNNING_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {DUNNING_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Zahlungserinnerung nach" hint="Tagen ab Fälligkeit" error={e("dunningDays")}>
          <Input
            name="dunningDays1"
            type="number"
            inputMode="numeric"
            min={1}
            max={180}
            defaultValue={billing.dunningDays[0]}
          />
        </Field>
        <Field label="1. Mahnung nach" hint="Tagen ab Fälligkeit">
          <Input
            name="dunningDays2"
            type="number"
            inputMode="numeric"
            min={1}
            max={180}
            defaultValue={billing.dunningDays[1]}
          />
        </Field>
        <Field label="Letzte Mahnung nach" hint="Tagen ab Fälligkeit">
          <Input
            name="dunningDays3"
            type="number"
            inputMode="numeric"
            min={1}
            max={180}
            defaultValue={billing.dunningDays[2]}
          />
        </Field>
        <Field
          label="Zahlungsfrist in Tagen"
          hint="Die nächste Stufe kommt frühestens danach."
          error={e("dunningDeadlineDays")}
        >
          <Input
            name="dunningDeadlineDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            defaultValue={billing.dunningDeadlineDays}
          />
        </Field>
        <Field
          label="Basiszinssatz in %"
          hint="OeNB, halbjährlich prüfen. Verzugszinsen: 9,2 Prozentpunkte darüber."
          error={e("baseRatePercent")}
        >
          <Input
            name="baseRatePercent"
            inputMode="decimal"
            defaultValue={String(billing.baseRatePercent).replace(".", ",")}
          />
        </Field>
        <div className="grid gap-1 sm:col-span-3">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="lateInterest"
              defaultChecked={billing.lateInterest}
              className="size-5 accent-accent"
            />
            Verzugszinsen nach § 456 UGB verlangen
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="collectionFee"
              defaultChecked={billing.collectionFee}
              className="size-5 accent-accent"
            />
            Pauschale von 40 € nach § 458 UGB verlangen
          </label>
          <p className="text-sm text-foreground-muted">
            Beides gilt nur gegenüber Unternehmen (Rechnungsprofil des Kunden) und erst ab der 1.
            Mahnung; die Zahlungserinnerung bleibt freundlich und kostenlos.
          </p>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3" disabled={disabled}>
        <legend className="mb-3 text-base font-semibold">Wartungsverträge</legend>
        <Field
          label="Ankündigung der Wertsicherung in Tagen"
          hint="So lange vor dem neuen Preis erfährt der Kunde davon."
          error={e("indexNoticeDays")}
        >
          <Input
            name="indexNoticeDays"
            type="number"
            inputMode="numeric"
            min={0}
            max={90}
            defaultValue={billing.indexNoticeDays}
          />
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled}>
          {pending ? "Wird gespeichert …" : "Speichern"}
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

export interface CatalogRow {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  unitPriceCents: number;
  billing: (typeof BILLING_INTERVALS)[number];
  vatRate: number;
}

/** Leistungskatalog: reusable lines for new offers. */
export function CatalogSettings({
  items,
  canEdit,
  showVat,
}: {
  items: CatalogRow[];
  canEdit: boolean;
  showVat: boolean;
}) {
  const [state, action, pending] = useActionState<BillingSettingsState, FormData>(addCatalogItem, {
    ok: false,
  });
  const e = (name: string) => state.errors?.[name];
  const disabled = !canEdit || pending;

  return (
    <div className="grid gap-6">
      {items.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          Noch keine Leistungen. Legen Sie an, was Sie oft anbieten, etwa „Website Basis“ oder
          „Wartung“.
        </p>
      ) : (
        <ul className="grid divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <span className="grid gap-0.5 text-sm">
                <span className="font-medium">{item.name}</span>
                <span className="text-foreground-muted">
                  {formatCents(item.unitPriceCents)} {BILLING_LABELS[item.billing]} · {item.unit}
                  {showVat ? ` · ${item.vatRate} % USt` : ""}
                </span>
              </span>
              {canEdit ? (
                <form action={archiveCatalogItem}>
                  <input type="hidden" name="id" value={item.id} />
                  <Button type="submit" variant="ghost" aria-label={`${item.name} archivieren`}>
                    <Archive aria-hidden />
                    Archivieren
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form
          action={action}
          className="grid gap-4 sm:grid-cols-2"
          key={state.ok ? state.message : "form"}
        >
          <h3 className="text-base font-semibold sm:col-span-2">Neue Leistung</h3>
          <Field label="Name" error={e("name")} className="sm:col-span-2">
            <Input name="name" required maxLength={160} />
          </Field>
          <Field label="Beschreibung" optional error={e("description")} className="sm:col-span-2">
            <Textarea name="description" rows={2} maxLength={2000} />
          </Field>
          <Field label="Preis netto in Euro" error={e("price")}>
            <Input name="price" inputMode="decimal" required />
          </Field>
          <Field label="Einheit" error={e("unit")}>
            <Select name="unit" defaultValue="Pauschal">
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Abrechnung" error={e("billing")}>
            <Select name="billing" defaultValue="once">
              {BILLING_INTERVALS.map((interval) => (
                <option key={interval} value={interval}>
                  {BILLING_LABELS[interval]}
                </option>
              ))}
            </Select>
          </Field>
          {showVat ? (
            <Field label="USt-Satz" error={e("vatRate")}>
              <Select name="vatRate" defaultValue="20">
                {VAT_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate} %
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={disabled}>
              Leistung anlegen
            </Button>
            <p
              aria-live="polite"
              className={state.ok ? "text-sm text-foreground-muted" : "text-sm text-danger"}
            >
              {state.message}
            </p>
          </div>
        </form>
      ) : null}
    </div>
  );
}
