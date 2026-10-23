import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceLinks } from "@/components/invoices/invoice-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/domain/authz";
import {
  CONTRACT_STATE_LABELS,
  CONTRACT_STATE_TONES,
  CONTRACT_TIMING_LABELS,
  INTERVAL_PERIOD_LABELS,
} from "@/domain/invoices/maintenance";
import { formatHours } from "@/domain/invoices/hour-quota";
import {
  ADJUSTMENT_STATUS_LABELS,
  INDEX_NAME,
  INDEX_SOURCE_URL,
  formatChange,
  formatIndex,
  monthLabel,
} from "@/domain/invoices/indexation";
import { germanDate, servicePeriodLabel } from "@/domain/invoices/totals";
import { BILLING_LABELS } from "@/domain/offers/schema";
import { formatCents, formatQuantity } from "@/domain/offers/totals";
import { loadContract } from "@/server/invoices/contracts";
import { listInvoices } from "@/server/invoices/manage";
import { requireCockpit } from "@/server/session";
import { LiveRefresh } from "../../../chat/live-refresh";
import { ContractNoticeForm, ContractSettingsForm } from "../contract-forms";
import {
  AnnounceAdjustmentForm,
  DeleteTimeEntryButton,
  IndexationSettingsForm,
  QuotaForm,
  TimeEntryForm,
  WithdrawAdjustmentButton,
} from "../indexation-forms";

type Params = Promise<{ id: string }>;

export const metadata: Metadata = { title: "Wartungsvertrag" };

const months = (count: number) => (count === 1 ? "1 Monat" : `${count} Monate`);

export default async function ContractPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { workspace, actor, tenant } = await requireCockpit();
  const loaded = await tenant(async (tx) => {
    const contract = await loadContract(tx, workspace.id, id);
    if (!contract) return null;
    return { ...contract, invoices: await listInvoices(tx, workspace.id, { contractId: id }) };
  });
  if (!loaded) notFound();
  const { contract, prospect, projectName, offerNumber, state, next, today, invoices } = loaded;
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });
  const restricted = prospect.restrictedAt !== null;
  const interval = loaded.terms.interval;
  const pendingAdjustment =
    loaded.adjustments.find((adjustment) => adjustment.status === "announced") ?? null;

  const facts: [string, string][] = [
    [
      "Abrechnung",
      `${BILLING_LABELS[interval]}, ${CONTRACT_TIMING_LABELS[contract.timing]}, je Kalender${INTERVAL_PERIOD_LABELS[interval].toLowerCase()}`,
    ],
    ["Beginn", contract.startDate ? germanDate(contract.startDate) : "noch offen"],
    ["Mindestlaufzeit", contract.minimumMonths > 0 ? months(contract.minimumMonths) : "keine"],
    [
      "Kündigungsfrist",
      contract.noticeMonths > 0
        ? `${months(contract.noticeMonths)} zum Monatsende`
        : "zum Monatsende",
    ],
    ["Abgerechnet bis", contract.billedUntil ? germanDate(contract.billedUntil) : "–"],
    [
      "Nächste Rechnung",
      restricted
        ? "keine (Sperrvermerk)"
        : next
          ? `${germanDate(next.billingDate)} für ${servicePeriodLabel(next)}${next.full ? "" : " (anteilig)"}`
          : contract.startDate
            ? "keine mehr"
            : "sobald der Beginn feststeht",
    ],
  ];
  if (contract.endDate) {
    facts.splice(2, 0, [
      "Ende",
      `${germanDate(contract.endDate)}${contract.noticeReceivedOn ? `, gekündigt am ${germanDate(contract.noticeReceivedOn)}` : ""}`,
    ]);
  }

  return (
    <div className="grid gap-6">
      <LiveRefresh events={["invoice.changed"]} prospectId={contract.prospectId} />
      <Link
        href="/rechnungen/vertraege"
        className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Wartungsverträge
      </Link>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{contract.title}</h1>
          <Badge tone={CONTRACT_STATE_TONES[state]}>{CONTRACT_STATE_LABELS[state]}</Badge>
        </div>
        <p className="text-foreground-muted">
          <Link href={`/kunden/${prospect.id}`} className="underline-offset-4 hover:underline">
            {prospect.companyName}
          </Link>
          {projectName ? ` · ${projectName}` : ""}
          {contract.offerId && offerNumber ? (
            <>
              {" · aus "}
              <Link
                href={`/angebote/${contract.offerId}`}
                className="underline-offset-4 hover:underline"
              >
                Angebot {offerNumber}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="lines-heading">
          <CardHeader>
            <CardTitle id="lines-heading">Leistungen</CardTitle>
            <CardDescription>
              Pro vollem {INTERVAL_PERIOD_LABELS[interval]} netto{" "}
              {formatCents(loaded.periodNetCents)}. Ein angebrochener Zeitraum wird tagesgenau
              anteilig berechnet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {contract.lines.map((line) => (
                <li key={line.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {formatQuantity(line.quantity)} {line.unit} {line.title}
                    {line.discountPercent > 0 ? (
                      <span className="text-foreground-muted">
                        {" "}
                        · {formatQuantity(line.discountPercent)} % Rabatt
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">{formatCents(line.unitPriceCents)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card aria-labelledby="term-heading">
          <CardHeader>
            <CardTitle id="term-heading">Laufzeit</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
              {facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-foreground-muted">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      {canManage && !restricted ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card aria-labelledby="settings-heading">
            <CardHeader>
              <CardTitle id="settings-heading">Beginn und Versand</CardTitle>
              <CardDescription>
                Automatisch gehen nur volle Zeiträume mit denselben Positionen wie die letzte
                Rechnung hinaus; sonst entsteht eine Aufgabe zur Freigabe.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ContractSettingsForm
                contractId={contract.id}
                startDate={contract.startDate}
                startLocked={contract.billedUntil !== null}
                sendMode={contract.sendMode}
                workspaceSendMode={loaded.workspaceSendMode}
              />
            </CardContent>
          </Card>
          <Card aria-labelledby="notice-heading">
            <CardHeader>
              <CardTitle id="notice-heading">Kündigung</CardTitle>
              <CardDescription>
                Der letzte Zeitraum wird bis zum Vertragsende anteilig abgerechnet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ContractNoticeForm
                contractId={contract.id}
                noticeReceivedOn={contract.noticeReceivedOn}
                endDate={contract.endDate}
                today={today}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="index-heading" id="wertsicherung" className="scroll-mt-20">
          <CardHeader>
            <CardTitle id="index-heading">Wertsicherung</CardTitle>
            <CardDescription>
              Die Preise folgen einmal jährlich dem {INDEX_NAME}, nach oben wie nach unten. Die
              Werte veröffentlicht die{" "}
              <a
                href={INDEX_SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                Statistik Austria
              </a>
              ; die Ankündigung geht {loaded.indexNoticeDays} Tage vor dem neuen Preis an den
              Kunden.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {/* Live: announcing or withdrawing replaces the form whose message would say so. */}
            {contract.indexed && contract.indexBaseMonth && contract.indexBaseTenths ? (
              <p className="text-sm" aria-live="polite">
                Basis {formatIndex(contract.indexBaseTenths)} ({monthLabel(contract.indexBaseMonth)}
                )
                {contract.indexThresholdPercent > 0
                  ? `, Schwellenwert ${contract.indexThresholdPercent} %`
                  : ""}
                .{" "}
                {pendingAdjustment
                  ? `Angekündigt: ${formatChange(pendingAdjustment.changeBp / 100)} ab ${germanDate(pendingAdjustment.effectiveFrom!)}.`
                  : loaded.indexDue
                    ? `Nächste Anpassung frühestens ab ${germanDate(loaded.indexDue)}.`
                    : "Keine weitere Anpassung vor dem Vertragsende."}
              </p>
            ) : (
              <p className="text-sm text-foreground-muted">
                {contract.indexed
                  ? "Bitte den Ausgangswert (Basis) eintragen."
                  : "Nicht wertgesichert."}
              </p>
            )}
            {canManage && !restricted && pendingAdjustment ? (
              <WithdrawAdjustmentButton
                contractId={contract.id}
                adjustmentId={pendingAdjustment.id}
              />
            ) : null}
            {canManage &&
            !restricted &&
            contract.indexed &&
            contract.indexBaseMonth &&
            contract.indexBaseTenths &&
            loaded.indexDue ? (
              <section aria-labelledby="announce-heading" className="grid gap-3">
                <h3 id="announce-heading" className="font-medium">
                  Neuen Indexwert eintragen
                </h3>
                <AnnounceAdjustmentForm
                  contractId={contract.id}
                  lines={contract.lines}
                  interval={interval}
                  baseMonth={contract.indexBaseMonth}
                  baseTenths={contract.indexBaseTenths}
                  thresholdPercent={contract.indexThresholdPercent}
                  dueOn={loaded.indexDue}
                  today={today}
                  noticeDays={loaded.indexNoticeDays}
                  billedUntil={contract.billedUntil}
                  recipient={loaded.recipient}
                />
              </section>
            ) : null}
            {loaded.adjustments.length > 0 ? (
              <section aria-labelledby="adjustments-heading" className="grid gap-2">
                <h3 id="adjustments-heading" className="font-medium">
                  Verlauf
                </h3>
                <ul className="grid gap-2 text-sm">
                  {loaded.adjustments.map((adjustment) => (
                    <li key={adjustment.id} className="flex flex-wrap items-center gap-2">
                      <Badge tone={adjustment.status === "applied" ? "accent" : "neutral"}>
                        {ADJUSTMENT_STATUS_LABELS[adjustment.status]}
                      </Badge>
                      <span>
                        {monthLabel(adjustment.indexMonth)}: {formatIndex(adjustment.indexTenths)} (
                        {formatChange(adjustment.changeBp / 100)} zu{" "}
                        {formatIndex(adjustment.baseTenths)})
                        {adjustment.effectiveFrom && adjustment.status !== "withdrawn"
                          ? `, ab ${germanDate(adjustment.effectiveFrom)}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {canManage && !restricted ? (
              <details className="grid gap-3">
                <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-medium">
                  Einstellungen der Wertsicherung
                </summary>
                <IndexationSettingsForm
                  contractId={contract.id}
                  indexed={contract.indexed}
                  indexMonth={contract.indexMonth}
                  baseMonth={contract.indexBaseMonth}
                  baseTenths={contract.indexBaseTenths}
                  thresholdPercent={contract.indexThresholdPercent}
                  baseLocked={pendingAdjustment !== null}
                />
              </details>
            ) : null}
          </CardContent>
        </Card>

        <Card aria-labelledby="hours-heading" id="stunden" className="scroll-mt-20">
          <CardHeader>
            <CardTitle id="hours-heading">Stundenkontingent</CardTitle>
            <CardDescription>
              {contract.hourlyRateCents
                ? `Mehrstunden zu ${formatCents(contract.hourlyRateCents)} netto, auf die Viertelstunde aufgerundet, mit der ${contract.timing === "advance" ? "nächsten" : "selben"} Rechnung. Nicht genutzte Stunden verfallen mit dem Zeitraum.`
                : "Ohne Stundensatz wird erfasste Zeit nur dokumentiert, nicht berechnet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {loaded.usage ? (
              <p className="text-sm">
                {servicePeriodLabel(loaded.usage.span)}: {formatHours(loaded.usage.usedMinutes)}{" "}
                erfasst
                {loaded.usage.includedMinutes > 0
                  ? ` von ${formatHours(loaded.usage.includedMinutes)} enthalten`
                  : ""}
                .
              </p>
            ) : null}
            {canManage && !restricted && contract.startDate ? (
              <TimeEntryForm contractId={contract.id} today={today} />
            ) : null}
            {loaded.timeEntries.length > 0 ? (
              <ul className="grid gap-1 text-sm" aria-label="Erfasste Zeiten">
                {loaded.timeEntries.map((entry) => {
                  const billed =
                    contract.overageBilledUntil !== null &&
                    entry.workDate <= contract.overageBilledUntil;
                  const label = `${germanDate(entry.workDate)} ${formatHours(entry.minutes)} ${entry.description}`;
                  return (
                    <li key={entry.id} className="flex items-start justify-between gap-3">
                      <span className="py-2.5">
                        <span className="tabular-nums">{germanDate(entry.workDate)}</span> ·{" "}
                        <span className="tabular-nums">{formatHours(entry.minutes)}</span> ·{" "}
                        {entry.description}
                        {billed ? (
                          <span className="text-foreground-muted"> · abgerechnet</span>
                        ) : null}
                      </span>
                      {canManage && !restricted && !billed ? (
                        <DeleteTimeEntryButton
                          contractId={contract.id}
                          entryId={entry.id}
                          label={label}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-foreground-muted">Noch keine Zeit erfasst.</p>
            )}
            {canManage && !restricted ? (
              <details className="grid gap-3">
                <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-medium">
                  Kontingent und Stundensatz
                </summary>
                <QuotaForm
                  contractId={contract.id}
                  includedMinutes={contract.includedMinutes}
                  hourlyRateCents={contract.hourlyRateCents}
                  interval={interval}
                />
              </details>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card aria-labelledby="invoices-heading">
        <CardHeader>
          <CardTitle id="invoices-heading">Rechnungen</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length > 0 ? (
            <InvoiceLinks invoices={invoices} />
          ) : (
            <p className="text-sm text-foreground-muted">
              {contract.startDate
                ? "Noch keine. Der stündliche Job legt die erste Rechnung am Abrechnungstag an."
                : "Noch keine. Tragen Sie den Beginn ein, dann legt der stündliche Job die Rechnungen an."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
