"use client";

import { Plus, Receipt, Trash2 } from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { EuroInput, QuantityInput } from "@/components/ui/money-input";
import {
  TAX_TREATMENTS,
  TAX_TREATMENT_LABELS,
  WITHOUT_VAT,
  type InvoiceDocument,
  type InvoiceKind,
  type InvoiceLine,
  type TaxTreatment,
} from "@/domain/invoices/schema";
import { treatmentNote } from "@/domain/invoices/tax";
import { germanDate, invoiceTotals } from "@/domain/invoices/totals";
import { formatQuantity, formatCents } from "@/domain/offers/totals";
import { UNITS, VAT_RATES, type VatRate } from "@/domain/offers/schema";
import { issueInvoiceAction, saveInvoiceDraftAction, type InvoiceActionResult } from "../actions";

const iconButton =
  "inline-flex size-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-40";

function nextLineId(lines: { id: string }[]): string {
  const ids = new Set(lines.map((line) => line.id));
  let n = lines.length + 1;
  while (ids.has(`pos-${n}`)) n++;
  return `pos-${n}`;
}

/** The draft of an invoice (§7.10, phase 7b): lines, service date, tax, texts, live totals. */
export function InvoiceEditor({
  invoiceId,
  kind,
  initial,
  defaultTreatment,
  smallBusinessNote,
  serverIssues,
}: {
  invoiceId: string;
  kind: InvoiceKind;
  initial: InvoiceDocument;
  defaultTreatment: TaxTreatment;
  smallBusinessNote: string;
  /** Problems found when the page loaded; replaced by the result of the last action. */
  serverIssues: { path?: string; message: string; level?: "error" | "warning" }[];
}) {
  const [draft, setDraft] = useState<InvoiceDocument>(initial);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<InvoiceActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const formId = useId();

  const update = (change: (current: InvoiceDocument) => InvoiceDocument) => {
    setDraft(change);
    setDirty(true);
  };
  const updateLine = (index: number, patch: Partial<InvoiceLine>) =>
    update((c) => ({
      ...c,
      lines: c.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  const totals = useMemo(() => invoiceTotals(draft, kind), [draft, kind]);
  const withoutVat = WITHOUT_VAT.has(draft.treatment);
  const issues = result?.issues ?? serverIssues;
  const issueFor = (path: string) =>
    result?.issues?.find((issue) => issue.path === path)?.message ?? undefined;
  const note = treatmentNote(draft.treatment, smallBusinessNote, draft.taxNote);

  const run = (action: () => Promise<InvoiceActionResult>) =>
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      if (outcome.ok) setDirty(false);
    });

  const actions = (
    <>
      <Button type="submit" form={formId} variant="secondary" disabled={pending || !dirty}>
        {pending ? "Speichert …" : "Entwurf speichern"}
      </Button>
      <Button disabled={pending} onClick={() => run(() => issueInvoiceAction(invoiceId, draft))}>
        <Receipt aria-hidden />
        Rechnung ausstellen
      </Button>
      <span className="text-sm text-foreground-muted">
        {dirty ? "Ungespeicherte Änderungen" : "Alles gespeichert"}
      </span>
    </>
  );

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <form
        id={formId}
        className="grid min-w-0 gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => saveInvoiceDraftAction(invoiceId, draft));
        }}
        aria-describedby="invoice-status"
      >
        <fieldset disabled={pending} className="grid min-w-0 gap-6">
          <legend className="sr-only">Rechnung bearbeiten</legend>
          <Card>
            <CardHeader>
              <CardTitle>Rechnung</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Titel" error={issueFor("title")}>
                <Input
                  value={draft.title}
                  maxLength={160}
                  onChange={(event) => update((c) => ({ ...c, title: event.target.value }))}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Leistungsdatum oder Beginn"
                  hint="Pflichtangabe auf jeder Rechnung."
                  error={issueFor("servicePeriod") ?? issueFor("servicePeriod.from")}
                >
                  <Input
                    type="date"
                    value={draft.servicePeriod?.from ?? ""}
                    onChange={(event) =>
                      update((c) => ({
                        ...c,
                        servicePeriod: event.target.value
                          ? { from: event.target.value, to: c.servicePeriod?.to }
                          : undefined,
                      }))
                    }
                  />
                </Field>
                <Field
                  label="Ende des Leistungszeitraums"
                  optional
                  hint="Leer lassen für ein einzelnes Datum."
                  error={issueFor("servicePeriod.to")}
                >
                  <Input
                    type="date"
                    value={draft.servicePeriod?.to ?? ""}
                    disabled={!draft.servicePeriod}
                    onChange={(event) =>
                      update((c) => ({
                        ...c,
                        servicePeriod: c.servicePeriod
                          ? { from: c.servicePeriod.from, to: event.target.value || undefined }
                          : undefined,
                      }))
                    }
                  />
                </Field>
              </div>
              <Field label="Einleitung" optional>
                <Textarea
                  rows={2}
                  value={draft.intro ?? ""}
                  maxLength={4000}
                  onChange={(event) => update((c) => ({ ...c, intro: event.target.value }))}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Positionen</CardTitle>
              <CardDescription>
                Preise netto pro Einheit.{" "}
                {withoutVat ? "Diese Rechnung weist keine Umsatzsteuer aus." : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {draft.lines.length === 0 ? (
                <p className="text-sm text-foreground-muted">
                  Noch keine Position. Fügen Sie eine hinzu.
                </p>
              ) : (
                <ol className="grid gap-3">
                  {draft.lines.map((line, index) => {
                    const label = line.title || `Position ${index + 1}`;
                    const net = totals.lines[index]?.netCents ?? 0;
                    return (
                      <li
                        key={line.id}
                        className="@container grid gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="flex items-end gap-1">
                          <Field
                            label={`Position ${index + 1}`}
                            className="min-w-0 flex-1"
                            error={issueFor(`lines.${index}.title`)}
                          >
                            <Input
                              value={line.title}
                              maxLength={160}
                              onChange={(event) => updateLine(index, { title: event.target.value })}
                            />
                          </Field>
                          <button
                            type="button"
                            className={iconButton}
                            aria-label={`${label} entfernen`}
                            onClick={() =>
                              update((c) => ({
                                ...c,
                                lines: c.lines.filter((_, i) => i !== index),
                              }))
                            }
                          >
                            <Trash2 aria-hidden className="size-4" />
                          </button>
                        </div>
                        <div
                          className={
                            withoutVat
                              ? "grid grid-cols-2 gap-3 @lg:grid-cols-[5.5rem_repeat(3,minmax(0,1fr))]"
                              : "grid grid-cols-2 gap-3 @lg:grid-cols-[5.5rem_repeat(4,minmax(0,1fr))]"
                          }
                        >
                          <Field label="Menge" error={issueFor(`lines.${index}.quantity`)}>
                            <QuantityInput
                              value={line.quantity}
                              onChange={(quantity) => updateLine(index, { quantity })}
                            />
                          </Field>
                          <Field label="Einheit">
                            <Select
                              value={line.unit}
                              onChange={(event) => updateLine(index, { unit: event.target.value })}
                            >
                              {[...new Set([...UNITS, line.unit])].map((unit) => (
                                <option key={unit} value={unit}>
                                  {unit}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field
                            label="Einzelpreis in €"
                            error={issueFor(`lines.${index}.unitPriceCents`)}
                          >
                            <EuroInput
                              cents={line.unitPriceCents}
                              onChange={(unitPriceCents) => updateLine(index, { unitPriceCents })}
                            />
                          </Field>
                          <Field label="Rabatt in %">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step="any"
                              value={line.discountPercent}
                              onChange={(event) =>
                                updateLine(index, {
                                  discountPercent: Math.min(
                                    100,
                                    Math.max(0, Number(event.target.value) || 0),
                                  ),
                                })
                              }
                            />
                          </Field>
                          {withoutVat ? null : (
                            <Field label="USt-Satz">
                              <Select
                                value={line.vatRate}
                                onChange={(event) =>
                                  updateLine(index, {
                                    vatRate: Number(event.target.value) as VatRate,
                                  })
                                }
                              >
                                {VAT_RATES.map((rate) => (
                                  <option key={rate} value={rate}>
                                    {rate} %
                                  </option>
                                ))}
                              </Select>
                            </Field>
                          )}
                        </div>
                        <Field label="Beschreibung" optional>
                          <Textarea
                            rows={1}
                            maxLength={1000}
                            value={line.description ?? ""}
                            onChange={(event) =>
                              updateLine(index, { description: event.target.value })
                            }
                          />
                        </Field>
                        <p className="text-right text-sm font-medium tabular-nums">
                          {line.discountPercent > 0 ? (
                            <span className="font-normal text-foreground-muted">
                              abzüglich {formatQuantity(line.discountPercent)} % ·{" "}
                            </span>
                          ) : null}
                          {formatCents(net)}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <Button
                  variant="secondary"
                  disabled={draft.lines.length >= 60}
                  onClick={() =>
                    update((c) => ({
                      ...c,
                      lines: [
                        ...c.lines,
                        {
                          id: nextLineId(c.lines),
                          title: "",
                          description: undefined,
                          quantity: 1,
                          unit: "Pauschal",
                          unitPriceCents: 0,
                          discountPercent: 0,
                          vatRate: 20,
                        },
                      ],
                    }))
                  }
                >
                  <Plus aria-hidden />
                  Position hinzufügen
                </Button>
              </div>
              <Field
                label="Gesamtrabatt in %"
                hint="Auf alle Positionen, je Steuersatz."
                className="max-w-xs"
              >
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.5"
                  className="max-w-32"
                  value={draft.discountPercent}
                  onChange={(event) =>
                    update((c) => ({
                      ...c,
                      discountPercent: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                    }))
                  }
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Steuer und Zahlung</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Umsatzsteuer"
                hint={`Vorschlag für diesen Kunden: ${TAX_TREATMENT_LABELS[defaultTreatment]}.`}
                error={issueFor("treatment")}
                className="sm:col-span-2"
              >
                <Select
                  value={draft.treatment}
                  onChange={(event) =>
                    update((c) => ({ ...c, treatment: event.target.value as TaxTreatment }))
                  }
                >
                  {TAX_TREATMENTS.map((treatment) => (
                    <option key={treatment} value={treatment}>
                      {TAX_TREATMENT_LABELS[treatment]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Eigener Steuerhinweis"
                optional
                hint={note ? `Sonst: „${note}“` : "Sonst steht die Umsatzsteuer je Satz da."}
                className="sm:col-span-2"
              >
                <Input
                  value={draft.taxNote ?? ""}
                  maxLength={400}
                  onChange={(event) => update((c) => ({ ...c, taxNote: event.target.value }))}
                />
              </Field>
              <Field label="Zahlungsziel in Tagen" hint="Ab dem Rechnungsdatum.">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={120}
                  value={draft.paymentTermsDays}
                  onChange={(event) =>
                    update((c) => ({
                      ...c,
                      paymentTermsDays: Math.min(120, Math.max(0, Number(event.target.value) || 0)),
                    }))
                  }
                />
              </Field>
              <Field label="Schlusstext" optional className="sm:col-span-2">
                <Textarea
                  rows={2}
                  value={draft.outro ?? ""}
                  maxLength={4000}
                  onChange={(event) => update((c) => ({ ...c, outro: event.target.value }))}
                />
              </Field>
            </CardContent>
          </Card>
        </fieldset>

        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur lg:bottom-4 xl:hidden">
          {actions}
          <span className="ml-auto text-sm font-medium tabular-nums">
            {formatCents(totals.dueCents)}
          </span>
        </div>
      </form>

      <aside className="grid gap-4 xl:sticky xl:top-20" aria-label="Zusammenfassung">
        <div className="hidden flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm xl:flex">
          {actions}
        </div>
        <div id="invoice-status" aria-live="polite" className="grid gap-2">
          {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
          {issues.length > 0 ? (
            <Alert tone={issues.some((issue) => issue.level !== "warning") ? "danger" : "warning"}>
              <span className="grid gap-1">
                <span className="font-medium">Vor dem Ausstellen:</span>
                <ul className="grid list-disc gap-0.5 pl-4">
                  {issues.map((issue) => (
                    <li key={`${issue.path}-${issue.message}`}>
                      {issue.level === "warning" ? "Hinweis: " : ""}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </span>
            </Alert>
          ) : null}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Summe</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm tabular-nums">
            {totals.discountCents !== 0 ? (
              <>
                <span className="flex justify-between">
                  <span className="text-foreground-muted">Positionen</span>
                  {formatCents(totals.linesCents)}
                </span>
                <span className="flex justify-between">
                  <span className="text-foreground-muted">
                    Gesamtrabatt {formatQuantity(draft.discountPercent)} %
                  </span>
                  {formatCents(-totals.discountCents)}
                </span>
              </>
            ) : null}
            {withoutVat ? null : (
              <>
                <span className="flex justify-between">
                  <span className="text-foreground-muted">Netto</span>
                  {formatCents(totals.netCents)}
                </span>
                {totals.vat.map((entry) => (
                  <span key={entry.rate} className="flex justify-between">
                    <span className="text-foreground-muted">USt {entry.rate} %</span>
                    {formatCents(entry.vatCents)}
                  </span>
                ))}
              </>
            )}
            <span className="flex justify-between text-base font-semibold">
              <span>Gesamt</span>
              {formatCents(totals.totalCents)}
            </span>
            {draft.deductions.map((deduction) => (
              <span key={deduction.invoiceId} className="flex justify-between gap-2">
                <span className="text-foreground-muted">
                  Anzahlung {deduction.number} vom {germanDate(deduction.issueDate)}
                </span>
                {formatCents(
                  -deduction.byRate.reduce(
                    (sum, entry) => sum + entry.netCents + entry.vatCents,
                    0,
                  ),
                )}
              </span>
            ))}
            {draft.deductions.length > 0 ? (
              <span className="flex justify-between text-base font-semibold">
                <span>Noch zu zahlen</span>
                {formatCents(totals.dueCents)}
              </span>
            ) : null}
            {note ? <p className="pt-2 text-xs text-foreground-muted">{note}</p> : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
