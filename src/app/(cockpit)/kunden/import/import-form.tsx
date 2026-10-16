"use client";

import { FileUp } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { parseCsv } from "@/domain/prospects/import";
import { importAction, previewImportAction, type ImportState, type PreviewState } from "./actions";

/** Upload → preview → import (§7.1). The file is read in the browser and sent as text. */
export function ImportForm({
  campaigns,
  fields,
}: {
  campaigns: { id: string; name: string }[];
  fields: string[];
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [target, setTarget] = useState(campaigns.length > 0 ? campaigns[0]!.id : "new");
  const [newName, setNewName] = useState("");
  const [result, setResult] = useState<ImportState | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (file: File | undefined) => {
    setPreview(null);
    setResult(null);
    if (!file) return;
    startTransition(async () => {
      const content = await file.text();
      setText(content);
      setPreview(await previewImportAction(content, parseCsv(content)[0] ?? []));
    });
  };

  const submit = () =>
    startTransition(async () => {
      setResult(
        await importAction(
          text,
          target === "none"
            ? { kind: "none" }
            : target === "new"
              ? { kind: "new", name: newName }
              : { kind: "existing", id: target },
        ),
      );
    });

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Datei wählen</CardTitle>
          <CardDescription>
            Erkannte Spalten: {fields.join(", ")}. Andere Spalten werden ignoriert.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field
            label="CSV-Datei"
            hint="Mit Semikolon oder Komma getrennt, erste Zeile Überschriften"
          >
            <Input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event) => choose(event.target.files?.[0])}
              className="h-auto py-2"
            />
          </Field>
        </CardContent>
      </Card>

      <div aria-live="polite" aria-busy={pending} className="grid gap-6">
        {preview && !preview.ok ? <Alert tone="danger">{preview.message}</Alert> : null}
        {preview?.ok ? (
          <Card>
            <CardHeader>
              <CardTitle>2. Vorschau prüfen</CardTitle>
              <CardDescription>
                {preview.valid} {preview.valid === 1 ? "Zeile" : "Zeilen"} bereit
                {preview.problems?.length
                  ? `, ${preview.problems.length} mit Fehlern (werden ausgelassen)`
                  : ""}
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="flex flex-wrap gap-2 text-sm">
                {preview.columns?.map((column, index) => (
                  <span
                    key={index}
                    className={
                      column.field
                        ? "rounded-md bg-success-soft px-2 py-1 text-success-foreground"
                        : "rounded-md bg-surface-sunken px-2 py-1 text-foreground-muted"
                    }
                  >
                    {column.header || "(leer)"} → {column.field ?? "ignoriert"}
                  </span>
                ))}
              </div>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Erste Zeilen der Datei</caption>
                <thead className="border-b border-border text-foreground-muted">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Zeile
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Firma
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Ort
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Ansprechpartner
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.sample?.map((row) => (
                    <tr key={row.line}>
                      <td className="py-2 pr-4 tabular-nums">{row.line}</td>
                      <td className="py-2 pr-4">{row.companyName}</td>
                      <td className="py-2 pr-4">{row.city ?? "–"}</td>
                      <td className="py-2">{row.contact ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.problems?.length ? (
                <details className="text-sm">
                  <summary className="min-h-11 cursor-pointer py-2 font-medium">
                    Zeilen mit Fehlern anzeigen
                  </summary>
                  <ul className="grid gap-1 text-foreground-muted">
                    {preview.problems.map((problem) => (
                      <li key={problem.line}>
                        Zeile {problem.line}: {problem.message}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {preview?.ok && !result?.ok ? (
          <Card>
            <CardHeader>
              <CardTitle>3. Importieren</CardTitle>
              <CardDescription>
                Firmen, die es am selben Ort schon gibt, werden übersprungen.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:max-w-md">
              <Field label="Kampagne">
                <Select value={target} onChange={(event) => setTarget(event.target.value)}>
                  {campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                  <option value="new">Neue Kampagne …</option>
                  <option value="none">Keine Kampagne</option>
                </Select>
              </Field>
              {target === "new" ? (
                <Field label="Name der neuen Kampagne" hint="z. B. Cafés Leipzig Oktober">
                  <Input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    maxLength={120}
                  />
                </Field>
              ) : null}
              <div>
                <Button onClick={submit} disabled={pending}>
                  <FileUp aria-hidden />
                  {pending ? "Wird importiert …" : `${preview.valid} importieren`}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <Alert tone={result.ok ? "success" : "danger"}>
            {result.message}{" "}
            {result.ok ? (
              <Link
                href={result.campaignId ? `/kunden?kampagne=${result.campaignId}` : "/kunden"}
                className="font-medium underline underline-offset-4"
              >
                Zur Kundenliste
              </Link>
            ) : null}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
