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
import { germanDate, servicePeriodLabel } from "@/domain/invoices/totals";
import { BILLING_LABELS } from "@/domain/offers/schema";
import { formatCents, formatQuantity } from "@/domain/offers/totals";
import { loadContract } from "@/server/invoices/contracts";
import { listInvoices } from "@/server/invoices/manage";
import { requireCockpit } from "@/server/session";
import { LiveRefresh } from "../../../chat/live-refresh";
import { ContractNoticeForm, ContractSettingsForm } from "../contract-forms";

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

  const facts: [string, string][] = [
    [
      "Abrechnung",
      `${BILLING_LABELS[interval]}, ${CONTRACT_TIMING_LABELS[contract.timing]}, je Kalender-${INTERVAL_PERIOD_LABELS[interval].toLowerCase()}`,
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
