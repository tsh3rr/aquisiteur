"use client";

import { ExternalLink } from "lucide-react";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { saveLegalAction, type LegalSettingsState } from "./legal-actions";

const initial: LegalSettingsState = { ok: false };

/** Settings → Impressum und Datenschutz: own texts or the generated ones (§9). */
export function LegalSettingsForm({
  legal,
  generated,
  publicOrigin,
  canEdit,
}: {
  legal: { imprintMarkdown?: string; privacyMarkdown?: string };
  generated: { imprint: string; privacy: string };
  publicOrigin: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveLegalAction, initial);
  const pages = [
    {
      name: "imprintMarkdown",
      label: "Impressum",
      path: "/impressum",
      value: legal.imprintMarkdown,
      fallback: generated.imprint,
      rows: 8,
    },
    {
      name: "privacyMarkdown",
      label: "Datenschutzerklärung",
      path: "/datenschutz",
      value: legal.privacyMarkdown,
      fallback: generated.privacy,
      rows: 14,
    },
  ];
  return (
    <form action={action} className="grid gap-6">
      <fieldset className="grid gap-6" disabled={!canEdit || pending}>
        <legend className="sr-only">Rechtstexte</legend>
        {pages.map((page) => (
          <div key={page.name} className="grid gap-2">
            <Field
              label={page.label}
              hint="Markdown. Leer lassen, dann erscheint der automatische Text aus Ihren Angaben."
            >
              <Textarea
                name={page.name}
                rows={page.rows}
                defaultValue={page.value ?? ""}
                className="font-mono text-sm"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <a
                href={`${publicOrigin}${page.path}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 text-accent underline-offset-4 hover:underline"
              >
                {page.label} ansehen
                <ExternalLink aria-hidden className="size-3.5" />
                <span className="sr-only">(neues Fenster)</span>
              </a>
              <details className="grow">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-foreground-muted">
                  Automatischen Text als Vorlage zeigen
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-surface-sunken p-3 text-xs whitespace-pre-wrap">
                  {page.fallback}
                </pre>
              </details>
            </div>
          </div>
        ))}
      </fieldset>
      <div aria-live="polite">
        {state.message ? (
          <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>
        ) : null}
      </div>
      <div>
        <Button type="submit" disabled={!canEdit || pending}>
          {pending ? "Speichert …" : "Rechtstexte speichern"}
        </Button>
      </div>
    </form>
  );
}
