"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  ExternalLink,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { TaxMode } from "@/domain/billing";
import { cn } from "@/lib/cn";
import {
  BILLING_INTERVALS,
  BILLING_LABELS,
  MILESTONE_TRIGGERS,
  PAYMENT_PLAN_PRESETS,
  PER_INTERVAL,
  TRIGGER_LABELS,
  UNITS,
  VAT_RATES,
  type BillingInterval,
  type Milestone,
  type OfferDocument,
  type OfferItem,
  type VatRate,
} from "@/domain/offers/schema";
import {
  defaultSelection,
  formatCents,
  formatQuantity,
  lineFor,
  offerTotals,
  parseEuroInput,
  paymentPlan,
} from "@/domain/offers/totals";
import {
  pushOfferToExposeAction,
  saveOfferDraftAction,
  sendOfferAction,
  withdrawOfferAction,
  type OfferActionResult,
} from "../actions";

export interface CatalogEntry {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  unitPriceCents: number;
  billing: BillingInterval;
  vatRate: number;
}

const section = "grid gap-4";
const iconButton =
  "inline-flex size-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-40";

/** Next free id like "pos-3" for a new line, variant or instalment. */
function nextId(prefix: string, taken: { id: string }[]): string {
  const ids = new Set(taken.map((entry) => entry.id));
  let n = taken.length + 1;
  while (ids.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (target < 0 || target >= list.length) return list;
  const copy = [...list];
  [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  return copy;
}

function parseQuantity(raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : null;
}

/** Euro amount typed freely ("1.234,50"), kept as cents once it parses. */
function EuroInput({
  cents,
  onChange,
  ...props
}: { cents: number; onChange: (cents: number) => void } & Omit<
  React.ComponentProps<"input">,
  "onChange" | "value"
>) {
  const [raw, setRaw] = useState(() => (cents / 100).toFixed(2).replace(".", ","));
  return (
    <Input
      {...props}
      inputMode="decimal"
      value={raw}
      onChange={(event) => {
        setRaw(event.target.value);
        const parsed = parseEuroInput(event.target.value);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => setRaw((cents / 100).toFixed(2).replace(".", ","))}
    />
  );
}

function QuantityInput({
  value,
  onChange,
  ...props
}: { value: number; onChange: (value: number) => void } & Omit<
  React.ComponentProps<"input">,
  "onChange" | "value"
>) {
  const [raw, setRaw] = useState(() => formatQuantity(value));
  return (
    <Input
      {...props}
      inputMode="decimal"
      value={raw}
      onChange={(event) => {
        setRaw(event.target.value);
        const parsed = parseQuantity(event.target.value);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => setRaw(formatQuantity(value))}
    />
  );
}

export function OfferEditor({
  offerId,
  initial,
  taxMode,
  taxNote,
  editable,
  sent,
  publicUrl,
  hasExpose,
  catalog,
}: {
  offerId: string;
  initial: OfferDocument;
  taxMode: TaxMode;
  taxNote: string;
  editable: boolean;
  /** Sent at least once and still open: withdrawing is possible. */
  sent: boolean;
  publicUrl: string | null;
  hasExpose: boolean;
  catalog: CatalogEntry[];
}) {
  const [draft, setDraft] = useState<OfferDocument>(initial);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<OfferActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [catalogPick, setCatalogPick] = useState("");
  const [copied, setCopied] = useState(false);
  const formId = useId();
  // Lines with extra details start open, so nothing set is hidden.
  const [expanded, setExpanded] = useState(
    () =>
      new Set(
        initial.items
          .filter((item) => item.description || item.discountPercent > 0 || item.optional)
          .map((item) => item.id),
      ),
  );
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const update = (change: (current: OfferDocument) => OfferDocument) => {
    setDraft((current) => change(current));
    setDirty(true);
  };
  const updateItem = (index: number, patch: Partial<OfferItem>) =>
    update((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  const updateMilestone = (index: number, patch: Partial<Milestone>) =>
    update((current) => ({
      ...current,
      paymentPlan: current.paymentPlan.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));

  const totals = useMemo(
    () => offerTotals(draft, defaultSelection(draft), taxMode),
    [draft, taxMode],
  );
  const plan = paymentPlan(draft.paymentPlan, totals.buckets.once?.totalCents ?? 0);
  const hasRecurring = draft.items.some((item) => item.billing !== "once");
  const issueFor = (path: string) =>
    result?.issues?.find((issue) => issue.path === path)?.message ?? undefined;

  const run = (action: () => Promise<OfferActionResult>) =>
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      if (outcome.ok) setDirty(false);
    });

  const addItem = (entry?: CatalogEntry) =>
    update((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          id: nextId("pos", current.items),
          title: entry?.name ?? "",
          description: entry?.description ?? undefined,
          quantity: 1,
          unit: entry?.unit ?? "Pauschal",
          unitPriceCents: entry?.unitPriceCents ?? 0,
          discountPercent: 0,
          vatRate: (VAT_RATES.find((rate) => rate === entry?.vatRate) ?? 20) as VatRate,
          billing: entry?.billing ?? "once",
          optional: false,
          selected: true,
          variantIds: [],
        },
      ],
    }));

  // Below xl these sit in a bar at the bottom of the form, from xl at the top of the sidebar.
  const actions = (
    <>
      <Button type="submit" form={formId} variant="secondary" disabled={pending || !dirty}>
        {pending ? "Speichert …" : "Entwurf speichern"}
      </Button>
      <Button disabled={pending} onClick={() => run(() => sendOfferAction(offerId, draft))}>
        <Send aria-hidden />
        {sent || publicUrl ? "Neue Version senden" : "Angebot fertigstellen"}
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
          run(() => saveOfferDraftAction(offerId, draft));
        }}
        aria-describedby="offer-status"
      >
        <fieldset disabled={!editable || pending} className="grid min-w-0 gap-6">
          <legend className="sr-only">Angebot bearbeiten</legend>
          <Card>
            <CardHeader>
              <CardTitle>Angebot</CardTitle>
            </CardHeader>
            <CardContent className={section}>
              <Field label="Titel" error={issueFor("title")}>
                <Input
                  value={draft.title}
                  maxLength={160}
                  onChange={(event) => update((c) => ({ ...c, title: event.target.value }))}
                />
              </Field>
              <Field label="Einleitung" optional>
                <Textarea
                  rows={3}
                  value={draft.intro ?? ""}
                  maxLength={4000}
                  onChange={(event) => update((c) => ({ ...c, intro: event.target.value }))}
                />
              </Field>
            </CardContent>
          </Card>

          {draft.variants.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Varianten</CardTitle>
                <CardDescription>
                  Zum Beispiel „Starter“ und „Pro“. Der Kunde wählt online eine; Positionen gelten
                  für alle Varianten oder nur für ausgewählte.
                </CardDescription>
              </CardHeader>
              <CardContent className={section}>
                <ul className="grid gap-3">
                  {draft.variants.map((variant, index) => (
                    <li
                      key={variant.id}
                      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
                    >
                      <Field
                        label={`Variante ${index + 1}`}
                        error={issueFor(`variants.${index}.title`)}
                      >
                        <Input
                          value={variant.title}
                          maxLength={80}
                          onChange={(event) =>
                            update((c) => ({
                              ...c,
                              variants: c.variants.map((v, i) =>
                                i === index ? { ...v, title: event.target.value } : v,
                              ),
                            }))
                          }
                        />
                      </Field>
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="recommended"
                          className="size-5 accent-accent"
                          checked={variant.recommended}
                          onChange={() =>
                            update((c) => ({
                              ...c,
                              variants: c.variants.map((v, i) => ({
                                ...v,
                                recommended: i === index,
                              })),
                            }))
                          }
                        />
                        Empfohlen
                      </label>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label={`Variante ${variant.title || index + 1} entfernen`}
                        onClick={() =>
                          update((c) => {
                            const variants = c.variants.filter((_, i) => i !== index);
                            const keep = variants.length >= 2;
                            return {
                              ...c,
                              variants: keep ? variants : [],
                              items: c.items.map((item) => ({
                                ...item,
                                variantIds: keep
                                  ? item.variantIds.filter((v) => v !== variant.id)
                                  : [],
                              })),
                            };
                          })
                        }
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
                {draft.variants.length < 4 ? (
                  <Button
                    variant="secondary"
                    className="justify-self-start"
                    onClick={() =>
                      update((c) => ({
                        ...c,
                        variants: [
                          ...c.variants,
                          {
                            id: nextId("v", c.variants),
                            title: "",
                            description: undefined,
                            recommended: false,
                          },
                        ],
                      }))
                    }
                  >
                    <Plus aria-hidden />
                    Weitere Variante
                  </Button>
                ) : null}
                {issueFor("variants") ? <Alert tone="danger">{issueFor("variants")}</Alert> : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Positionen</CardTitle>
              <CardDescription>
                Preise netto pro Einheit.{" "}
                {taxMode === "small_business"
                  ? "Als Kleinunternehmer wird keine Umsatzsteuer ausgewiesen."
                  : "Die Umsatzsteuer wird pro Satz auf die Summe gerechnet."}
              </CardDescription>
            </CardHeader>
            <CardContent className={section}>
              {draft.items.length === 0 ? (
                <p className="text-sm text-foreground-muted">
                  Noch keine Position. Fügen Sie eine aus dem Leistungskatalog oder eine leere
                  hinzu.
                </p>
              ) : (
                <ol className="grid gap-3">
                  {draft.items.map((item, index) => {
                    const label = item.title || `Position ${index + 1}`;
                    const open = expanded.has(item.id);
                    const line = lineFor(item);
                    const extras = [
                      item.description ? "Beschreibung" : null,
                      item.discountPercent > 0
                        ? `${formatQuantity(item.discountPercent)} % Rabatt`
                        : null,
                      taxMode === "standard" && item.vatRate !== 20
                        ? `${item.vatRate} % USt`
                        : null,
                      item.optional
                        ? item.selected
                          ? "optional, vorausgewählt"
                          : "optional"
                        : null,
                      draft.variants.length > 0 && item.variantIds.length > 0
                        ? `nur ${draft.variants
                            .filter((v) => item.variantIds.includes(v.id))
                            .map((v) => v.title || "Ohne Namen")
                            .join(", ")}`
                        : null,
                    ].filter(Boolean);
                    return (
                      <li
                        key={item.id}
                        className="@container grid gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="flex items-end gap-1">
                          <Field
                            label={`Position ${index + 1}`}
                            className="min-w-0 flex-1"
                            error={issueFor(`items.${index}.title`)}
                          >
                            <Input
                              value={item.title}
                              maxLength={160}
                              onChange={(event) => updateItem(index, { title: event.target.value })}
                            />
                          </Field>
                          <button
                            type="button"
                            className={iconButton}
                            aria-label={`${label} nach oben`}
                            disabled={index === 0}
                            onClick={() =>
                              update((c) => ({ ...c, items: move(c.items, index, -1) }))
                            }
                          >
                            <ArrowUp aria-hidden className="size-4" />
                          </button>
                          <button
                            type="button"
                            className={iconButton}
                            aria-label={`${label} nach unten`}
                            disabled={index === draft.items.length - 1}
                            onClick={() =>
                              update((c) => ({ ...c, items: move(c.items, index, 1) }))
                            }
                          >
                            <ArrowDown aria-hidden className="size-4" />
                          </button>
                          <button
                            type="button"
                            className={iconButton}
                            aria-label={`${label} entfernen`}
                            onClick={() =>
                              update((c) => ({
                                ...c,
                                items: c.items.filter((_, i) => i !== index),
                              }))
                            }
                          >
                            <Trash2 aria-hidden className="size-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3 @lg:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                          <Field label="Menge" error={issueFor(`items.${index}.quantity`)}>
                            <QuantityInput
                              value={item.quantity}
                              onChange={(quantity) => updateItem(index, { quantity })}
                            />
                          </Field>
                          <Field label="Einheit">
                            <Select
                              value={item.unit}
                              onChange={(event) => updateItem(index, { unit: event.target.value })}
                            >
                              {[...new Set([...UNITS, item.unit])].map((unit) => (
                                <option key={unit} value={unit}>
                                  {unit}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field
                            label="Einzelpreis in €"
                            error={issueFor(`items.${index}.unitPriceCents`)}
                          >
                            <EuroInput
                              cents={item.unitPriceCents}
                              onChange={(unitPriceCents) => updateItem(index, { unitPriceCents })}
                            />
                          </Field>
                          <Field label="Abrechnung">
                            <Select
                              value={item.billing}
                              onChange={(event) =>
                                updateItem(index, {
                                  billing: event.target.value as BillingInterval,
                                })
                              }
                            >
                              {BILLING_INTERVALS.map((interval) => (
                                <option key={interval} value={interval}>
                                  {BILLING_LABELS[interval]}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-x-4">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={`${item.id}-details`}
                            onClick={() => toggle(item.id)}
                            className="inline-flex min-h-11 min-w-0 items-center gap-1.5 text-left text-sm text-foreground-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                          >
                            <ChevronDown
                              aria-hidden
                              className={cn(
                                "size-4 shrink-0 transition-transform motion-reduce:transition-none",
                                open && "rotate-180",
                              )}
                            />
                            <span>
                              Weitere Angaben
                              {extras.length > 0 ? (
                                <span className="text-foreground"> · {extras.join(" · ")}</span>
                              ) : null}
                              <span className="sr-only"> zu {label}</span>
                            </span>
                          </button>
                          <span className="ml-auto text-sm font-medium tabular-nums">
                            {formatCents(line.netCents)}
                            {item.billing === "once" ? null : (
                              <span className="font-normal text-foreground-muted">
                                {" "}
                                {PER_INTERVAL[item.billing]}
                              </span>
                            )}
                          </span>
                        </div>
                        <div
                          id={`${item.id}-details`}
                          hidden={!open}
                          className="grid gap-3 border-t border-border pt-3"
                        >
                          <Field label="Beschreibung" optional>
                            <Textarea
                              rows={2}
                              maxLength={1000}
                              value={item.description ?? ""}
                              onChange={(event) =>
                                updateItem(index, { description: event.target.value })
                              }
                            />
                          </Field>
                          <div className="grid grid-cols-2 gap-3 @lg:grid-cols-4">
                            <Field label="Rabatt in %">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step="any"
                                value={item.discountPercent}
                                onChange={(event) =>
                                  updateItem(index, {
                                    discountPercent: Math.min(
                                      100,
                                      Math.max(0, Number(event.target.value) || 0),
                                    ),
                                  })
                                }
                              />
                            </Field>
                            {taxMode === "standard" ? (
                              <Field label="USt-Satz">
                                <Select
                                  value={item.vatRate}
                                  onChange={(event) =>
                                    updateItem(index, {
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
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-x-6">
                            <label className="flex min-h-11 items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="size-5 accent-accent"
                                checked={item.optional}
                                onChange={(event) =>
                                  updateItem(index, { optional: event.target.checked })
                                }
                              />
                              Optional (Kunde kann abwählen)
                            </label>
                            {item.optional ? (
                              <label className="flex min-h-11 items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  className="size-5 accent-accent"
                                  checked={item.selected}
                                  onChange={(event) =>
                                    updateItem(index, { selected: event.target.checked })
                                  }
                                />
                                Vorausgewählt
                              </label>
                            ) : null}
                          </div>
                          {draft.variants.length > 0 ? (
                            <fieldset className="grid gap-1">
                              <legend className="text-sm font-medium">Gilt für</legend>
                              <div className="flex flex-wrap gap-x-6">
                                {draft.variants.map((variant) => (
                                  <label
                                    key={variant.id}
                                    className="flex min-h-11 items-center gap-2 text-sm"
                                  >
                                    <input
                                      type="checkbox"
                                      className="size-5 accent-accent"
                                      checked={
                                        item.variantIds.length === 0 ||
                                        item.variantIds.includes(variant.id)
                                      }
                                      onChange={(event) => {
                                        const current =
                                          item.variantIds.length === 0
                                            ? draft.variants.map((v) => v.id)
                                            : item.variantIds;
                                        const next = event.target.checked
                                          ? [...current, variant.id]
                                          : current.filter((v) => v !== variant.id);
                                        updateItem(index, {
                                          variantIds:
                                            next.length === draft.variants.length ? [] : next,
                                        });
                                      }}
                                    />
                                    {variant.title || "Ohne Namen"}
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="flex flex-wrap items-end gap-2">
                {catalog.length > 0 ? (
                  <>
                    <Field label="Aus dem Leistungskatalog" className="min-w-56 flex-1">
                      <Select
                        value={catalogPick}
                        onChange={(event) => setCatalogPick(event.target.value)}
                      >
                        <option value="">Leistung wählen …</option>
                        {catalog.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name} · {formatCents(entry.unitPriceCents)}
                            {entry.billing === "once" ? "" : ` ${PER_INTERVAL[entry.billing]}`}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button
                      variant="secondary"
                      disabled={!catalogPick}
                      onClick={() => {
                        addItem(catalog.find((entry) => entry.id === catalogPick));
                        setCatalogPick("");
                      }}
                    >
                      <Plus aria-hidden />
                      Hinzufügen
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() => addItem()}
                  disabled={draft.items.length >= 60}
                >
                  <Plus aria-hidden />
                  Leere Position
                </Button>
                {draft.variants.length === 0 ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      update((c) => ({
                        ...c,
                        variants: [
                          {
                            id: "v-basis",
                            title: "Basis",
                            description: undefined,
                            recommended: false,
                          },
                          {
                            id: "v-plus",
                            title: "Plus",
                            description: undefined,
                            recommended: true,
                          },
                        ],
                      }))
                    }
                  >
                    <Plus aria-hidden />
                    Varianten anbieten
                  </Button>
                ) : null}
              </div>
              <Field
                label="Gesamtrabatt in %"
                hint="Auf alle einmaligen Positionen, laufende Leistungen bleiben unverändert."
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
              <CardTitle>Zahlungsplan</CardTitle>
              <CardDescription>
                Teilt die einmaligen Kosten in Tranchen. Die letzte Tranche nimmt immer den Rest,
                damit die Summe stimmt.
              </CardDescription>
            </CardHeader>
            <CardContent className={section}>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Vorlagen">
                {PAYMENT_PLAN_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    variant="secondary"
                    size="sm"
                    onClick={() => update((c) => ({ ...c, paymentPlan: preset.plan }))}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <ol className="grid gap-3">
                {draft.paymentPlan.map((milestone, index) => {
                  const last = index === draft.paymentPlan.length - 1;
                  const amount = plan.instalments[index]?.amountCents ?? 0;
                  return (
                    <li
                      key={milestone.id}
                      className="@container grid gap-2 rounded-lg border border-border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">
                          Tranche {index + 1} · {formatCents(amount)}
                        </h3>
                        <button
                          type="button"
                          className={iconButton}
                          aria-label={`Tranche ${index + 1} entfernen`}
                          disabled={draft.paymentPlan.length === 1}
                          onClick={() =>
                            update((c) => ({
                              ...c,
                              paymentPlan: c.paymentPlan.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          <Trash2 aria-hidden className="size-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @3xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
                        <Field
                          label="Bezeichnung"
                          className="col-span-2 @md:col-span-3 @3xl:col-span-1"
                          error={issueFor(`paymentPlan.${index}.title`)}
                        >
                          <Input
                            value={milestone.title}
                            maxLength={120}
                            onChange={(event) =>
                              updateMilestone(index, { title: event.target.value })
                            }
                          />
                        </Field>
                        {last && draft.paymentPlan.length > 1 ? (
                          <p className="self-end pb-3 text-sm text-foreground-muted">
                            Anteil: der Rest
                          </p>
                        ) : (
                          <Field
                            label={
                              milestone.share.kind === "percent" ? "Anteil in %" : "Betrag in €"
                            }
                          >
                            {milestone.share.kind === "percent" ? (
                              <Input
                                type="number"
                                min={1}
                                max={100}
                                step="any"
                                value={milestone.share.value}
                                onChange={(event) =>
                                  updateMilestone(index, {
                                    share: {
                                      kind: "percent",
                                      value: Math.min(
                                        100,
                                        Math.max(0.01, Number(event.target.value) || 0.01),
                                      ),
                                    },
                                  })
                                }
                              />
                            ) : (
                              <EuroInput
                                cents={milestone.share.cents}
                                onChange={(cents) =>
                                  updateMilestone(index, {
                                    share: { kind: "amount", cents: Math.max(1, cents) },
                                  })
                                }
                              />
                            )}
                          </Field>
                        )}
                        {last && draft.paymentPlan.length > 1 ? null : (
                          <Field label="Angabe als">
                            <Select
                              value={milestone.share.kind}
                              onChange={(event) =>
                                updateMilestone(index, {
                                  share:
                                    event.target.value === "percent"
                                      ? { kind: "percent", value: 50 }
                                      : { kind: "amount", cents: Math.max(1, amount) },
                                })
                              }
                            >
                              <option value="percent">Prozent</option>
                              <option value="amount">Festbetrag</option>
                            </Select>
                          </Field>
                        )}
                        <Field label="Fällig">
                          <Select
                            value={milestone.trigger}
                            onChange={(event) =>
                              updateMilestone(index, {
                                trigger: event.target.value as Milestone["trigger"],
                              })
                            }
                          >
                            {MILESTONE_TRIGGERS.map((trigger) => (
                              <option key={trigger} value={trigger}>
                                {TRIGGER_LABELS[trigger]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        {milestone.trigger === "date" ? (
                          <Field label="Datum" error={issueFor(`paymentPlan.${index}.date`)}>
                            <Input
                              type="date"
                              value={milestone.date ?? ""}
                              onChange={(event) =>
                                updateMilestone(index, { date: event.target.value || undefined })
                              }
                            />
                          </Field>
                        ) : null}
                        {milestone.trigger === "after_previous" ? (
                          <Field label="Tage danach" error={issueFor(`paymentPlan.${index}.days`)}>
                            <Input
                              type="number"
                              min={1}
                              max={730}
                              value={milestone.days ?? ""}
                              onChange={(event) =>
                                updateMilestone(index, {
                                  days: Number(event.target.value) || undefined,
                                })
                              }
                            />
                          </Field>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {plan.overbooked ? (
                <Alert tone="danger">Die Tranchen vor der letzten sind höher als die Summe.</Alert>
              ) : null}
              {issueFor("paymentPlan") ? (
                <Alert tone="danger">{issueFor("paymentPlan")}</Alert>
              ) : null}
              {draft.paymentPlan.length < 8 ? (
                <Button
                  variant="secondary"
                  className="justify-self-start"
                  onClick={() =>
                    update((c) => ({
                      ...c,
                      paymentPlan: [
                        ...c.paymentPlan.map((m, i) =>
                          i === c.paymentPlan.length - 1 && c.paymentPlan.length === 1
                            ? { ...m, share: { kind: "percent" as const, value: 50 } }
                            : m,
                        ),
                        {
                          id: nextId("m", c.paymentPlan),
                          title: "Schlusszahlung",
                          share: { kind: "percent" as const, value: 50 },
                          trigger: "milestone" as const,
                        },
                      ],
                    }))
                  }
                >
                  <Plus aria-hidden />
                  Tranche hinzufügen
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {hasRecurring ? (
            <Card>
              <CardHeader>
                <CardTitle>Wartungsvertrag</CardTitle>
                <CardDescription>
                  Gilt für die wiederkehrenden Positionen. Daraus entsteht nach der Annahme der
                  Wartungsvertrag mit seinen Rechnungen.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Field label="Beginn">
                  <Select
                    value={draft.maintenance.startOn}
                    onChange={(event) =>
                      update((c) => ({
                        ...c,
                        maintenance: {
                          ...c.maintenance,
                          startOn: event.target.value as OfferDocument["maintenance"]["startOn"],
                        },
                      }))
                    }
                  >
                    <option value="go_live">mit dem Go-live</option>
                    <option value="acceptance">mit der Annahme</option>
                    <option value="date">an einem Datum</option>
                  </Select>
                </Field>
                {draft.maintenance.startOn === "date" ? (
                  <Field label="Startdatum">
                    <Input
                      type="date"
                      value={draft.maintenance.startDate ?? ""}
                      onChange={(event) =>
                        update((c) => ({
                          ...c,
                          maintenance: {
                            ...c.maintenance,
                            startDate: event.target.value || undefined,
                          },
                        }))
                      }
                    />
                  </Field>
                ) : null}
                <Field label="Mindestlaufzeit in Monaten">
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    value={draft.maintenance.minimumMonths}
                    onChange={(event) =>
                      update((c) => ({
                        ...c,
                        maintenance: {
                          ...c.maintenance,
                          minimumMonths: Math.min(60, Math.max(0, Number(event.target.value) || 0)),
                        },
                      }))
                    }
                  />
                </Field>
                <Field label="Kündigungsfrist in Monaten">
                  <Input
                    type="number"
                    min={0}
                    max={12}
                    value={draft.maintenance.noticeMonths}
                    onChange={(event) =>
                      update((c) => ({
                        ...c,
                        maintenance: {
                          ...c.maintenance,
                          noticeMonths: Math.min(12, Math.max(0, Number(event.target.value) || 0)),
                        },
                      }))
                    }
                  />
                </Field>
                <Field label="Abrechnung">
                  <Select
                    value={draft.maintenance.timing}
                    onChange={(event) =>
                      update((c) => ({
                        ...c,
                        maintenance: {
                          ...c.maintenance,
                          timing: event.target.value as OfferDocument["maintenance"]["timing"],
                        },
                      }))
                    }
                  >
                    <option value="advance">im Voraus</option>
                    <option value="arrears">nachträglich</option>
                  </Select>
                </Field>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Abschluss</CardTitle>
            </CardHeader>
            <CardContent className={section}>
              <Field label="Text unter dem Angebot" optional>
                <Textarea
                  rows={3}
                  value={draft.outro ?? ""}
                  maxLength={4000}
                  onChange={(event) => update((c) => ({ ...c, outro: event.target.value }))}
                />
              </Field>
              <Field
                label="Gültig nach dem Senden"
                hint="In Tagen, danach lässt es sich nicht mehr annehmen."
              >
                <Input
                  type="number"
                  min={1}
                  max={365}
                  className="max-w-32"
                  value={draft.validDays}
                  onChange={(event) =>
                    update((c) => ({
                      ...c,
                      validDays: Math.max(1, Number(event.target.value) || 1),
                    }))
                  }
                />
              </Field>
            </CardContent>
          </Card>
        </fieldset>

        {editable ? (
          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur lg:bottom-4 xl:hidden">
            {actions}
            {totals.buckets.once ? (
              <span className="ml-auto text-sm font-medium tabular-nums">
                Einmalig {formatCents(totals.buckets.once.totalCents)}
              </span>
            ) : null}
          </div>
        ) : null}
      </form>

      <aside className="grid gap-4 xl:sticky xl:top-20" aria-label="Zusammenfassung">
        {editable ? (
          <div className="hidden flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm xl:flex">
            {actions}
          </div>
        ) : null}
        <div id="offer-status" aria-live="polite">
          {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Summe</CardTitle>
            <CardDescription>
              {draft.variants.length > 0
                ? `Für die empfohlene Variante, mit vorausgewählten Optionen.`
                : "Mit den vorausgewählten Optionen."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {Object.keys(totals.buckets).length === 0 ? (
              <p className="text-foreground-muted">Noch keine Beträge.</p>
            ) : (
              <dl className="grid gap-3">
                {BILLING_INTERVALS.map((interval) => {
                  const bucket = totals.buckets[interval];
                  if (!bucket) return null;
                  return (
                    <div key={interval} className="grid gap-1">
                      <dt className="font-medium">
                        {interval === "once"
                          ? "Einmalig"
                          : `Wiederkehrend ${PER_INTERVAL[interval]}`}
                      </dt>
                      <dd className="grid gap-0.5 tabular-nums">
                        {bucket.discountCents > 0 ? (
                          <>
                            <span className="flex justify-between">
                              <span className="text-foreground-muted">Positionen</span>
                              {formatCents(bucket.linesCents)}
                            </span>
                            <span className="flex justify-between">
                              <span className="text-foreground-muted">
                                Gesamtrabatt {draft.discountPercent} %
                              </span>
                              −{formatCents(bucket.discountCents)}
                            </span>
                          </>
                        ) : null}
                        {taxMode === "standard" ? (
                          <>
                            <span className="flex justify-between">
                              <span className="text-foreground-muted">Netto</span>
                              {formatCents(bucket.netCents)}
                            </span>
                            {bucket.vat.map((vat) => (
                              <span key={vat.rate} className="flex justify-between">
                                <span className="text-foreground-muted">USt {vat.rate} %</span>
                                {formatCents(vat.vatCents)}
                              </span>
                            ))}
                          </>
                        ) : null}
                        <span className="flex justify-between text-base font-semibold">
                          <span>Gesamt</span>
                          {formatCents(bucket.totalCents)}
                        </span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
            <p className="text-xs text-foreground-muted">{taxNote}</p>
          </CardContent>
        </Card>

        {publicUrl ? (
          <Card>
            <CardHeader>
              <CardTitle>Link für den Kunden</CardTitle>
              <CardDescription>Zeigt immer die zuletzt gesendete Version.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <code className="rounded-md bg-surface-sunken p-2 text-xs break-all">
                {publicUrl}
              </code>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(publicUrl).then(() => setCopied(true));
                  }}
                >
                  <Copy aria-hidden />
                  {copied ? "Kopiert" : "Kopieren"}
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden />
                    Öffnen<span className="sr-only"> (neuer Tab)</span>
                  </a>
                </Button>
              </div>
              <p className="text-xs text-foreground-muted">
                Ihr eigenes Öffnen zählt nicht als Ansicht, wenn dieses Gerät als Ihres markiert
                ist.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {hasExpose && draft.items.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Exposé</CardTitle>
              <CardDescription>
                Übernimmt die Positionen der empfohlenen Variante in den Preisblock des Exposés, als
                neue Version.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="secondary"
                disabled={pending || dirty}
                onClick={() => run(() => pushOfferToExposeAction(offerId))}
              >
                Ins Exposé übernehmen
              </Button>
              {dirty ? (
                <p className="mt-2 text-xs text-foreground-muted">Erst den Entwurf speichern.</p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {sent ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => withdrawOfferAction(offerId))}
          >
            Angebot zurückziehen
          </Button>
        ) : null}
      </aside>
    </div>
  );
}
