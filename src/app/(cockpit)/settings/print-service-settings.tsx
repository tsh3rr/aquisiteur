"use client";

import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { PingenSettingsView } from "@/server/letters/providers";
import {
  savePrintService,
  testPrintService,
  type PrintServiceState,
} from "./print-service-actions";
import { Toggle } from "./toggle";

function RadioOption({
  value,
  label,
  hint,
  checked,
  onChange,
}: {
  value: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
      <input
        type="radio"
        name="provider"
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-5 shrink-0 accent-accent"
      />
      <span className="grid gap-0.5 font-medium">
        {label}
        <span className="font-normal text-foreground-muted">{hint}</span>
      </span>
    </label>
  );
}

/** Settings → Briefe → Druckdienst: print yourself or send through Pingen (§7.9). */
export function PrintServiceForm({
  pingen,
  webhookUrl,
  canEdit,
}: {
  pingen: PingenSettingsView;
  webhookUrl: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<PrintServiceState, FormData>(savePrintService, {
    ok: false,
  });
  const [provider, setProvider] = useState(pingen.enabled ? "pingen" : "manual");
  const [test, setTest] = useState<PrintServiceState | null>(null);
  const [testing, startTest] = useTransition();
  const disabled = !canEdit || pending || !pingen.canStoreSecrets;

  return (
    <form action={action} className="grid gap-4">
      <fieldset className="grid gap-4" disabled={disabled}>
        <legend className="mb-1 text-base font-semibold">Druckdienst</legend>
        {!pingen.canStoreSecrets ? (
          <Alert tone="warning">
            Auf dem Server fehlt INTEGRATIONS_ENCRYPTION_KEY. Ohne ihn lassen sich keine
            Zugangsdaten speichern, siehe docs/DEPLOY.md.
          </Alert>
        ) : null}
        <div role="radiogroup" aria-label="Wer druckt die Briefe?" className="grid gap-1">
          {[
            {
              value: "manual",
              label: "Selbst drucken",
              hint: "PDF herunterladen, drucken, „Als versendet markieren“.",
            },
            {
              value: "pingen",
              label: "Pingen druckt und verschickt",
              hint: "Pingen druckt die Briefe, frankiert sie und meldet den Versand zurück. Kostet pro Brief, Abrechnung bei Pingen.",
            },
          ].map((option) => (
            <RadioOption
              key={option.value}
              value={option.value}
              label={option.label}
              hint={option.hint}
              checked={provider === option.value}
              onChange={() => setProvider(option.value)}
            />
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2" hidden={provider !== "pingen"}>
          <p className="text-sm text-foreground-muted sm:col-span-2">
            Die Zugangsdaten legen Sie in Pingen unter „Developers“ als API-Client mit „Client
            Credentials“ an. Secrets werden verschlüsselt gespeichert und nie wieder angezeigt; ein
            leeres Feld behält den gespeicherten Wert. Vor dem echten Versand braucht es einen
            Auftragsverarbeitungsvertrag mit Pingen.
          </p>
          <Field label="Organisations-ID" hint="Steht in jeder Pingen-Adresse nach /organisations/">
            <Input
              name="organisationId"
              defaultValue={pingen.organisationId}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Client-ID">
            <Input
              name="clientId"
              defaultValue={pingen.clientId}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field
            label="Client-Secret"
            hint={
              pingen.hasClientSecret ? "Gespeichert. Leer lassen, um es zu behalten." : undefined
            }
          >
            <Input name="clientSecret" type="password" autoComplete="new-password" />
          </Field>
          <Field
            label="Webhook-Signaturschlüssel"
            hint={
              pingen.hasWebhookSecret
                ? "Gespeichert. Leer lassen, um ihn zu behalten."
                : "Optional. Ohne Webhook fragt Aquisiteur den Status stündlich ab."
            }
          >
            <Input name="webhookSecret" type="password" autoComplete="new-password" />
          </Field>
          <div className="grid gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Webhook-Adresse für Pingen</span>
            <code className="rounded-md bg-surface-sunken px-3 py-2 font-mono text-xs break-all">
              {webhookUrl}
            </code>
            <span className="text-foreground-muted">
              In Pingen unter „Webhooks“ für die Kategorien „sent“, „undeliverable“ und „issues“
              eintragen, mit demselben Signaturschlüssel wie oben.
            </span>
          </div>
          <div className="sm:col-span-2">
            <Toggle
              name="staging"
              label="Testumgebung von Pingen verwenden"
              hint="Kostenlos, es wird nichts gedruckt. Die Zugangsdaten der Testumgebung sind andere als die echten."
              defaultChecked={pingen.staging}
              disabled={disabled}
            />
          </div>
        </div>
      </fieldset>
      <div aria-live="polite" className="grid gap-2">
        {state.message ? (
          <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>
        ) : null}
        {test ? <Alert tone={test.ok ? "success" : "danger"}>{test.message}</Alert> : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={disabled}>
          {pending ? "Speichert …" : "Speichern"}
        </Button>
        {provider === "pingen" ? (
          <Button
            type="button"
            variant="secondary"
            disabled={!canEdit || testing}
            onClick={() => startTest(async () => setTest(await testPrintService()))}
          >
            {testing ? "Wird geprüft …" : "Verbindung testen"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
