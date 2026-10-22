"use client";

import { clsx } from "clsx";
import { useId, useMemo, useState } from "react";
import type { TaxMode } from "@/domain/billing";
import {
  INTERVAL_MONTHS,
  PER_INTERVAL,
  type OfferDocument,
  type OfferSelection,
  type OfferStatus,
  type RecurringInterval,
} from "@/domain/offers/schema";
import {
  defaultSelection,
  formatCents,
  formatQuantity,
  normaliseSelection,
  offerTotals,
  paymentPlan,
  type BucketTotals,
  type Instalment,
} from "@/domain/offers/totals";

/**
 * Interactive part of the offer page: variant and option choice with live
 * totals, payment plan, and the accept/decline forms (§7.10). Plain clsx and
 * no Intl, like the exposé (ADR-0048).
 */

type Answer = "idle" | "sending" | "accepted" | "declined" | "error";

const MESSAGES: Record<number, string> = {
  404: "Dieses Angebot gibt es nicht mehr.",
  409: "Das Angebot wurde inzwischen geändert oder ist nicht mehr offen. Bitte laden Sie die Seite neu.",
  429: "Zu viele Versuche. Bitte versuchen Sie es in einer Stunde noch einmal.",
};

const START_LABELS = {
  acceptance: "ab Auftrag",
  go_live: "ab Go-live",
  date: "ab",
} as const;

function germanDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

function dueLabel(instalment: Instalment): string {
  switch (instalment.trigger) {
    case "acceptance":
      return "bei Auftrag";
    case "date":
      return instalment.date ? `am ${germanDate(instalment.date)}` : "zum Termin";
    case "after_previous":
      return `${instalment.days ?? 0} Tage nach der vorigen Zahlung`;
    default:
      return "bei Erreichen";
  }
}

function months(value: number): string {
  return value === 1 ? "1 Monat" : `${value} Monaten`;
}

const panel = "grid gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6";
const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-5 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60";
const input =
  "min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function TotalRows({
  bucket,
  taxMode,
  label,
  discountPercent,
}: {
  bucket: BucketTotals;
  taxMode: TaxMode;
  label: string;
  discountPercent: number;
}) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {bucket.discountCents > 0 ? (
        <>
          <dt className="text-foreground-muted">Leistungen</dt>
          <dd className="text-right tabular-nums">{formatCents(bucket.linesCents)}</dd>
          <dt className="text-foreground-muted">Gesamtrabatt {discountPercent} %</dt>
          <dd className="text-right tabular-nums">−{formatCents(bucket.discountCents)}</dd>
        </>
      ) : null}
      {taxMode === "standard" ? (
        <>
          <dt className="text-foreground-muted">Netto</dt>
          <dd className="text-right tabular-nums">{formatCents(bucket.netCents)}</dd>
          {bucket.vat.map((entry) => (
            <div key={entry.rate} className="contents">
              <dt className="text-foreground-muted">
                {entry.rate} % USt auf {formatCents(entry.baseCents)}
              </dt>
              <dd className="text-right tabular-nums">{formatCents(entry.vatCents)}</dd>
            </div>
          ))}
        </>
      ) : null}
      <dt className="text-base font-semibold">{label}</dt>
      <dd className="text-right text-base font-semibold tabular-nums">
        {formatCents(bucket.totalCents)}
      </dd>
    </dl>
  );
}

export function OfferView({
  token,
  status,
  versionId,
  document,
  taxMode,
  taxNote,
  owner,
  validUntil,
  acceptance,
}: {
  token: string;
  status: OfferStatus | "expired";
  versionId: string;
  document: OfferDocument;
  taxMode: TaxMode;
  taxNote: string;
  owner: string;
  validUntil: string;
  acceptance: {
    name: string;
    acceptedAt: string;
    variantId: string | null;
    optionalIds: string[];
  } | null;
}) {
  const open = status === "sent";
  const [selection, setSelection] = useState<OfferSelection>(() =>
    acceptance
      ? normaliseSelection(document, {
          variantId: acceptance.variantId,
          optionalIds: acceptance.optionalIds,
        })
      : defaultSelection(document),
  );
  const [answer, setAnswer] = useState<Answer>("idle");
  const [error, setError] = useState<string | null>(null);
  const totals = useMemo(
    () => offerTotals(document, selection, taxMode),
    [document, selection, taxMode],
  );
  const once = totals.buckets.once;
  const plan = once ? paymentPlan(document.paymentPlan, once.totalCents) : null;
  const recurring = (Object.keys(totals.buckets) as (keyof typeof totals.buckets)[]).filter(
    (interval): interval is RecurringInterval => interval !== "once",
  );
  const variantName = useId();
  const nameId = useId();
  const roleId = useId();
  const reasonId = useId();
  const confirmId = useId();
  const chosen = new Set(selection.optionalIds);
  const canChoose = open && answer !== "accepted" && answer !== "declined";
  const terms = document.maintenance;

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setAnswer("sending");
    setError(null);
    try {
      const response = await fetch("/t/offer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, versionId, ...body }),
      });
      if (response.ok) return true;
      const payload =
        response.status === 400
          ? ((await response.json().catch(() => null)) as { message?: string } | null)
          : null;
      setError(
        payload?.message ??
          MESSAGES[response.status] ??
          "Das hat nicht geklappt. Bitte versuchen Sie es noch einmal.",
      );
    } catch {
      setError("Keine Verbindung. Bitte prüfen Sie Ihr Internet und versuchen Sie es erneut.");
    }
    setAnswer("error");
    return false;
  }

  async function accept(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("confirmed") !== "on") {
      setAnswer("error");
      setError("Bitte bestätigen Sie die Beauftragung mit dem Häkchen.");
      return;
    }
    const ok = await send({
      answer: "accept",
      name: String(form.get("name") ?? ""),
      role: String(form.get("role") ?? "") || undefined,
      confirmed: true,
      selection,
      website: String(form.get("website") ?? "") || undefined,
    });
    if (ok) setAnswer("accepted");
  }

  async function decline(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send({
      answer: "decline",
      reason: String(form.get("reason") ?? "") || undefined,
      website: String(form.get("website") ?? "") || undefined,
    });
    if (ok) setAnswer("declined");
  }

  const closedNotice =
    status === "accepted" && acceptance
      ? `Angenommen am ${acceptance.acceptedAt} von ${acceptance.name}. Vielen Dank für Ihren Auftrag!`
      : status === "declined"
        ? `Sie haben dieses Angebot abgelehnt. ${owner} meldet sich bei Bedarf mit einem neuen Vorschlag.`
        : status === "withdrawn"
          ? `${owner} hat dieses Angebot zurückgezogen. Es kann nicht mehr angenommen werden.`
          : status === "expired"
            ? `Dieses Angebot war bis ${validUntil} gültig. Fragen Sie gern bei ${owner} nach einer aktualisierten Fassung.`
            : null;

  return (
    <div className="grid gap-8">
      {closedNotice ? (
        <p
          role="status"
          className={clsx(
            "rounded-xl border p-4 font-medium",
            status === "accepted"
              ? "border-success bg-success-soft text-success-foreground"
              : "border-border bg-surface-sunken",
          )}
        >
          {closedNotice}
        </p>
      ) : null}

      {document.variants.length > 0 ? (
        <fieldset className="grid gap-3" disabled={!canChoose}>
          <legend className="mb-3 text-xl font-semibold">Variante wählen</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {document.variants.map((variant) => (
              <label
                key={variant.id}
                className={clsx(
                  "relative grid cursor-pointer gap-1 rounded-2xl border-2 bg-surface p-5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring",
                  selection.variantId === variant.id ? "border-accent" : "border-border",
                )}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name={variantName}
                    value={variant.id}
                    checked={selection.variantId === variant.id}
                    onChange={() =>
                      setSelection((current) =>
                        normaliseSelection(document, {
                          variantId: variant.id,
                          optionalIds: current.optionalIds,
                        }),
                      )
                    }
                    className="size-5 accent-accent"
                  />
                  <span className="text-lg font-semibold">{variant.title}</span>
                  {variant.recommended ? (
                    <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
                      Empfohlen
                    </span>
                  ) : null}
                </span>
                {variant.description ? (
                  <span className="text-sm text-foreground-muted">{variant.description}</span>
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <section aria-labelledby="leistungen" className="grid gap-4">
        <h2 id="leistungen" className="text-xl font-semibold">
          Leistungen
        </h2>
        <ul className="grid gap-3">
          {document.items
            .filter(
              (item) =>
                item.variantIds.length === 0 ||
                (selection.variantId !== null && item.variantIds.includes(selection.variantId)),
            )
            .map((item) => {
              const line = totals.lines.find((entry) => entry.id === item.id);
              const included = !item.optional || chosen.has(item.id);
              const recurringLabel =
                item.billing === "once" ? "" : ` ${PER_INTERVAL[item.billing]}`;
              const price =
                formatCents(
                  line?.netCents ??
                    Math.round(
                      item.quantity * item.unitPriceCents * (1 - item.discountPercent / 100),
                    ),
                ) + recurringLabel;
              return (
                <li
                  key={item.id}
                  className={clsx(
                    "grid gap-2 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[1fr_auto] sm:gap-6",
                    !included && "border-dashed",
                  )}
                >
                  <div className="grid gap-1">
                    {item.optional ? (
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 font-medium">
                        <input
                          type="checkbox"
                          checked={chosen.has(item.id)}
                          disabled={!canChoose}
                          onChange={(event) =>
                            setSelection((current) => ({
                              ...current,
                              optionalIds: event.target.checked
                                ? [...current.optionalIds, item.id]
                                : current.optionalIds.filter((entry) => entry !== item.id),
                            }))
                          }
                          className="size-5 accent-accent"
                        />
                        <span>
                          {item.title}{" "}
                          <span className="text-sm font-normal text-foreground-muted">
                            (optional)
                          </span>
                        </span>
                      </label>
                    ) : (
                      <span className="font-medium">{item.title}</span>
                    )}
                    {item.description ? (
                      <p className="text-sm whitespace-pre-line text-foreground-muted">
                        {item.description}
                      </p>
                    ) : null}
                    {item.quantity !== 1 || item.unit !== "Pauschal" ? (
                      <p className="text-sm text-foreground-muted tabular-nums">
                        {formatQuantity(item.quantity)} {item.unit} ×{" "}
                        {formatCents(item.unitPriceCents)}
                        {item.discountPercent > 0 ? ` · ${item.discountPercent} % Rabatt` : ""}
                      </p>
                    ) : item.discountPercent > 0 ? (
                      <p className="text-sm text-foreground-muted">
                        {item.discountPercent} % Rabatt
                      </p>
                    ) : null}
                  </div>
                  <p
                    className={clsx(
                      "font-semibold whitespace-nowrap tabular-nums sm:text-right",
                      !included && "text-foreground-muted",
                    )}
                  >
                    {price}
                    {!included ? <span className="sr-only"> (nicht gewählt)</span> : null}
                  </p>
                </li>
              );
            })}
        </ul>
      </section>

      <section aria-labelledby="summe" className={panel} aria-live="polite">
        <h2 id="summe" className="text-xl font-semibold">
          Summe
        </h2>
        {once ? (
          <TotalRows
            bucket={once}
            taxMode={taxMode}
            discountPercent={document.discountPercent}
            label={recurring.length > 0 ? "Einmalig" : "Gesamt"}
          />
        ) : null}
        {recurring.map((interval) => (
          <TotalRows
            key={interval}
            bucket={totals.buckets[interval]!}
            taxMode={taxMode}
            discountPercent={0}
            label={`Laufend ${PER_INTERVAL[interval]}`}
          />
        ))}
        {!once && recurring.length === 0 ? (
          <p className="text-foreground-muted">Bitte wählen Sie mindestens eine Leistung.</p>
        ) : null}
        <p className="text-sm text-foreground-muted">{taxNote}</p>
      </section>

      {plan && once && once.totalCents > 0 ? (
        <section aria-labelledby="zahlung" className="grid gap-4">
          <h2 id="zahlung" className="text-xl font-semibold">
            Zahlungsplan
          </h2>
          <ol className="grid gap-2">
            {plan.instalments.map((instalment, index) => (
              <li
                key={instalment.id}
                className="grid grid-cols-[auto_1fr_auto] items-baseline gap-3 rounded-xl border border-border bg-surface p-4"
              >
                <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-soft-foreground">
                  {index + 1}
                </span>
                <span className="grid">
                  <span className="font-medium">{instalment.title}</span>
                  <span className="text-sm text-foreground-muted">
                    {instalment.shareLabel} · fällig {dueLabel(instalment)}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">
                  {formatCents(instalment.amountCents)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {recurring.length > 0 ? (
        <section aria-labelledby="laufend" className="grid gap-3">
          <h2 id="laufend" className="text-xl font-semibold">
            Laufende Leistungen
          </h2>
          <ul className="grid list-disc gap-1 pl-5 text-foreground-muted">
            <li>
              Beginn{" "}
              {terms.startOn === "date" && terms.startDate
                ? `${START_LABELS.date} ${germanDate(terms.startDate)}`
                : START_LABELS[terms.startOn]}
              , Abrechnung{" "}
              {terms.timing === "advance" ? "jeweils im Voraus" : "jeweils im Nachhinein"}.
            </li>
            {terms.minimumMonths > 0 ? (
              <li>Mindestlaufzeit {months(terms.minimumMonths).replace("Monaten", "Monate")}.</li>
            ) : null}
            <li>
              {terms.noticeMonths > 0
                ? `Danach mit ${months(terms.noticeMonths)} Frist kündbar.`
                : "Jederzeit kündbar."}
            </li>
            {recurring.some((interval) => INTERVAL_MONTHS[interval] > 1) ? (
              <li>Bei längeren Intervallen wird der Betrag für den ganzen Zeitraum berechnet.</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {answer === "accepted" ? (
        <p
          role="status"
          className="rounded-xl border border-success bg-success-soft p-5 text-lg font-medium text-success-foreground"
        >
          Vielen Dank! Ihr Auftrag ist bei {owner} angekommen. Die nächsten Schritte folgen in
          Kürze.
        </p>
      ) : answer === "declined" ? (
        <p role="status" className="rounded-xl border border-border bg-surface-sunken p-5">
          Danke für Ihre Rückmeldung. {owner} weiß jetzt Bescheid.
        </p>
      ) : open ? (
        <section aria-labelledby="annehmen" className={panel}>
          <h2 id="annehmen" className="text-xl font-semibold">
            Angebot annehmen
          </h2>
          <p className="text-sm text-foreground-muted">
            Mit Ihrer Annahme kommt der Auftrag zu den oben gewählten Leistungen und Preisen
            zustande. Gültig bis {validUntil}.
          </p>
          <form onSubmit={accept} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label htmlFor={nameId} className="text-sm font-medium">
                  Ihr Name
                </label>
                <input
                  id={nameId}
                  name="name"
                  required
                  maxLength={120}
                  autoComplete="name"
                  className={input}
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor={roleId} className="text-sm font-medium">
                  Funktion <span className="font-normal text-foreground-muted">(optional)</span>
                </label>
                <input
                  id={roleId}
                  name="role"
                  maxLength={120}
                  autoComplete="organization-title"
                  className={input}
                />
              </div>
            </div>
            {/* Honeypot (ADR-0066): hidden from people and screen readers. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="absolute -left-[9999px] h-px w-px opacity-0"
            />
            <label htmlFor={confirmId} className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                id={confirmId}
                type="checkbox"
                name="confirmed"
                required
                className="mt-0.5 size-5 shrink-0 accent-accent"
              />
              <span>
                Ich beauftrage {owner} verbindlich mit den gewählten Leistungen
                {once ? ` (einmalig ${formatCents(once.totalCents)}` : ""}
                {recurring.length > 0
                  ? `${once ? ", " : " ("}laufend ${recurring
                      .map(
                        (interval) =>
                          `${formatCents(totals.buckets[interval]!.totalCents)} ${PER_INTERVAL[interval]}`,
                      )
                      .join(", ")}`
                  : ""}
                {once || recurring.length > 0 ? ")" : ""} und bin dazu berechtigt.
              </span>
            </label>
            <div aria-live="assertive">
              {answer === "error" && error ? (
                <p role="alert" className="text-sm font-medium text-danger">
                  {error}
                </p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={answer === "sending" || (!once && recurring.length === 0)}
              className={clsx(button, "bg-accent text-accent-foreground hover:bg-accent-hover")}
            >
              {answer === "sending" ? "Wird gesendet …" : "Verbindlich annehmen"}
            </button>
          </form>
          <details className="border-t border-border pt-4">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground-muted hover:text-foreground">
              Angebot ablehnen …
            </summary>
            <form onSubmit={decline} className="mt-3 grid gap-3" noValidate>
              <div className="grid gap-1.5">
                <label htmlFor={reasonId} className="text-sm font-medium">
                  Was passt nicht?{" "}
                  <span className="font-normal text-foreground-muted">(optional)</span>
                </label>
                <textarea id={reasonId} name="reason" rows={3} maxLength={1000} className={input} />
              </div>
              <button
                type="submit"
                disabled={answer === "sending"}
                className={clsx(
                  button,
                  "justify-self-start border border-border bg-surface hover:bg-surface-sunken",
                )}
              >
                Ablehnen
              </button>
            </form>
          </details>
        </section>
      ) : null}
    </div>
  );
}
