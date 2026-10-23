import { ArrowLeft, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoicePdfButton } from "@/components/invoices/pdf-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/domain/authz";
import { formatIban } from "@/domain/invoices/epc";
import {
  INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  TAX_TREATMENT_LABELS,
  WITHOUT_VAT,
  type InvoiceParty,
} from "@/domain/invoices/schema";
import { germanDate, servicePeriodLabel } from "@/domain/invoices/totals";
import { formatCents, formatQuantity } from "@/domain/offers/totals";
import { EMAIL_STATUS_LABELS, EMAIL_STATUS_TONES } from "@/domain/email";
import { DUNNING_LEVEL_LABELS, formatRate, type DunningClaim } from "@/domain/invoices/dunning";
import { loadInvoice } from "@/server/invoices/manage";
import { loadInvoiceDunning } from "@/server/invoices/dunning";
import { loadInvoiceDelivery } from "@/server/invoices/send";
import { localDateString } from "@/domain/tasks";
import { requireCockpit } from "@/server/session";
import { LiveRefresh } from "../../chat/live-refresh";
import { deleteInvoiceDraftAction, deletePaymentAction, loadInvoicePdfAction } from "../actions";
import { CancelInvoice, PaymentForm } from "./invoice-actions";
import { DiscardReminderButton, PrepareReminderButton, SendReminder } from "./invoice-dunning";
import { SendInvoice } from "./invoice-send";
import { InvoiceEditorLazy } from "./invoice-editor-lazy";

type Params = Promise<{ id: string }>;

export const metadata: Metadata = { title: "Rechnung" };

function Claim({
  claim,
}: {
  claim: Pick<
    DunningClaim,
    "openCents" | "interestCents" | "interestRateBp" | "feeCents" | "totalCents"
  >;
}) {
  return (
    <dl className="grid max-w-sm gap-1 text-sm tabular-nums">
      <div className="flex justify-between gap-4">
        <dt className="text-foreground-muted">Offen</dt>
        <dd>{formatCents(claim.openCents)}</dd>
      </div>
      {claim.interestCents > 0 ? (
        <div className="flex justify-between gap-4">
          <dt className="text-foreground-muted">
            Verzugszinsen{claim.interestRateBp ? ` ${formatRate(claim.interestRateBp)}` : ""}
          </dt>
          <dd>{formatCents(claim.interestCents)}</dd>
        </div>
      ) : null}
      {claim.feeCents > 0 ? (
        <div className="flex justify-between gap-4">
          <dt className="text-foreground-muted">Pauschale § 458 UGB</dt>
          <dd>{formatCents(claim.feeCents)}</dd>
        </div>
      ) : null}
      {claim.totalCents !== claim.openCents ? (
        <div className="flex justify-between gap-4 font-semibold">
          <dt>Forderung</dt>
          <dd>{formatCents(claim.totalCents)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function Party({ party }: { party: InvoiceParty }) {
  return (
    <address className="grid text-sm not-italic">
      <span className="font-medium">{party.name}</span>
      {party.street ? <span>{party.street}</span> : null}
      {party.postalCode || party.city ? (
        <span>{[party.postalCode, party.city].filter(Boolean).join(" ")}</span>
      ) : null}
      <span className="text-foreground-muted">
        {party.country}
        {party.vatId ? ` · UID ${party.vatId}` : ""}
      </span>
    </address>
  );
}

export default async function InvoicePage({ params }: { params: Params }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { workspace, actor, tenant } = await requireCockpit();
  const loaded = await tenant((tx) => loadInvoice(tx, workspace.id, id));
  if (!loaded) notFound();
  const delivery =
    loaded.invoice.status === "draft"
      ? null
      : await tenant((tx) => loadInvoiceDelivery(tx, workspace.id, id));
  const dunning =
    loaded.invoice.status === "draft"
      ? null
      : await tenant((tx) => loadInvoiceDunning(tx, workspace.id, id));
  const { invoice, document, prospect, totals, issuer, recipient } = loaded;
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });
  const draft = invoice.status === "draft";
  const withoutVat = WITHOUT_VAT.has(document.treatment);
  const openCents = Math.max(0, totals.dueCents - loaded.paidCents);
  const back = invoice.projectId
    ? {
        href: `/projekte/${invoice.projectId}` as const,
        label: `${prospect.companyName} · ${loaded.projectName}`,
      }
    : { href: `/kunden/${prospect.id}` as const, label: prospect.companyName };
  const filename = `${invoice.number ?? "rechnungsentwurf"}.pdf`;

  return (
    <div className="grid gap-6">
      <LiveRefresh events={["invoice.changed"]} prospectId={prospect.id} />
      <Link
        href={back.href}
        className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {back.label}
      </Link>

      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {INVOICE_KIND_LABELS[invoice.kind]} {invoice.number ?? "(Entwurf)"}
          </h1>
          <Badge tone={INVOICE_STATUS_TONES[loaded.status]}>
            {INVOICE_STATUS_LABELS[loaded.status]}
          </Badge>
        </div>
        <p className="text-foreground-muted">
          {[
            document.title || null,
            invoice.issueDate ? `vom ${germanDate(invoice.issueDate)}` : "noch ohne Nummer",
            invoice.dueDate && invoice.kind !== "cancellation"
              ? `fällig am ${germanDate(invoice.dueDate)}`
              : null,
            loaded.offer?.number ? `aus Angebot ${loaded.offer.number}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {invoice.contractId ? (
          <p className="text-sm">
            <Link
              href={`/rechnungen/vertraege/${invoice.contractId}`}
              className="text-accent underline underline-offset-4"
            >
              Zum Wartungsvertrag
            </Link>
          </p>
        ) : null}
        {loaded.cancelledBy ? (
          <p className="text-sm" role="status">
            Storniert durch{" "}
            <Link
              href={`/rechnungen/${loaded.cancelledBy.id}`}
              className="text-accent underline underline-offset-4"
            >
              {loaded.cancelledBy.number}
            </Link>
            .
          </p>
        ) : null}
        {loaded.cancels ? (
          <p className="text-sm">
            Storniert die Rechnung{" "}
            <Link
              href={`/rechnungen/${loaded.cancels.id}`}
              className="text-accent underline underline-offset-4"
            >
              {loaded.cancels.number}
            </Link>
            .
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          <InvoicePdfButton
            invoiceId={invoice.id}
            load={loadInvoicePdfAction}
            filename={filename}
            label={draft ? "Vorschau als PDF" : "PDF herunterladen"}
          />
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>An</CardTitle>
            <CardDescription>
              {draft ? (
                <>
                  Aus dem{" "}
                  <Link
                    href={`/kunden/${prospect.id}#rechnungsprofil`}
                    className="text-accent underline underline-offset-4"
                  >
                    Rechnungsprofil des Kunden
                  </Link>
                  ; wird beim Ausstellen festgeschrieben.
                </>
              ) : (
                "Festgeschrieben beim Ausstellen."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Party party={recipient} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Von</CardTitle>
            <CardDescription>
              {draft ? (
                <>
                  Aus den{" "}
                  <Link
                    href="/settings#angebote"
                    className="text-accent underline underline-offset-4"
                  >
                    Einstellungen
                  </Link>
                  .
                </>
              ) : (
                TAX_TREATMENT_LABELS[document.treatment]
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Party party={issuer} />
            {issuer.iban ? (
              <p className="text-sm text-foreground-muted">IBAN {formatIban(issuer.iban)}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {draft && canManage ? (
        <InvoiceEditorLazy
          invoiceId={invoice.id}
          kind={invoice.kind}
          initial={document}
          defaultTreatment={loaded.defaultTreatment}
          smallBusinessNote={loaded.settings.billing.smallBusinessNote}
          serverIssues={loaded.issues}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Positionen</CardTitle>
            <CardDescription>
              {document.servicePeriod?.to ? "Leistungszeitraum" : "Leistungsdatum"}{" "}
              {servicePeriodLabel(document.servicePeriod)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <caption className="sr-only">Positionen der Rechnung</caption>
                <thead className="border-b border-border text-foreground-muted">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Leistung
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Menge
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Einzelpreis
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Betrag
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {totals.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-2 pr-4">
                        {line.title}
                        {withoutVat ? "" : ` (${line.vatRate} % USt)`}
                        {line.description ? (
                          <span className="block text-foreground-muted">{line.description}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
                        {formatQuantity(line.quantity)} {line.unit}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatCents(line.unitPriceCents)}
                      </td>
                      <td className="py-2 text-right tabular-nums">{formatCents(line.netCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto grid w-full max-w-sm gap-1 text-sm tabular-nums">
              {withoutVat ? null : (
                <>
                  <div className="flex justify-between">
                    <dt className="text-foreground-muted">Netto</dt>
                    <dd>{formatCents(totals.netCents)}</dd>
                  </div>
                  {totals.vat.map((entry) => (
                    <div key={entry.rate} className="flex justify-between">
                      <dt className="text-foreground-muted">USt {entry.rate} %</dt>
                      <dd>{formatCents(entry.vatCents)}</dd>
                    </div>
                  ))}
                </>
              )}
              <div className="flex justify-between text-base font-semibold">
                <dt>Gesamt</dt>
                <dd>{formatCents(totals.totalCents)}</dd>
              </div>
              {document.deductions.map((deduction) => (
                <div key={deduction.invoiceId} className="flex justify-between gap-2">
                  <dt className="text-foreground-muted">Anzahlung {deduction.number}</dt>
                  <dd>
                    {formatCents(
                      -deduction.byRate.reduce(
                        (sum, entry) => sum + entry.netCents + entry.vatCents,
                        0,
                      ),
                    )}
                  </dd>
                </div>
              ))}
              {document.deductions.length > 0 ? (
                <div className="flex justify-between text-base font-semibold">
                  <dt>Zahlbetrag</dt>
                  <dd>{formatCents(totals.dueCents)}</dd>
                </div>
              ) : null}
            </dl>
            {loaded.taxNote ? (
              <p className="text-sm text-foreground-muted">{loaded.taxNote}</p>
            ) : null}
            {invoice.sha256 ? (
              <p className="text-xs text-foreground-muted">
                Prüfsumme der ausgestellten Fassung:{" "}
                <code className="font-mono break-all">{invoice.sha256}</code>
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {!draft && invoice.kind !== "cancellation" ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card id="zahlungen">
            <CardHeader>
              <CardTitle>Zahlungen</CardTitle>
              <CardDescription>
                {loaded.paidCents > 0
                  ? `${formatCents(loaded.paidCents)} von ${formatCents(totals.dueCents)} bezahlt.`
                  : `Noch nichts bezahlt, offen ${formatCents(totals.dueCents)}.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {loaded.payments.length > 0 ? (
                <ul className="grid gap-1 text-sm">
                  {loaded.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        {germanDate(payment.paidOn)} ·{" "}
                        <span className="font-medium tabular-nums">
                          {formatCents(payment.amountCents)}
                        </span>
                        {payment.note ? (
                          <span className="text-foreground-muted"> · {payment.note}</span>
                        ) : null}
                      </span>
                      {canManage ? (
                        <form action={deletePaymentAction}>
                          <input type="hidden" name="id" value={payment.id} />
                          <button
                            type="submit"
                            className="inline-flex size-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                            aria-label={`Zahlung vom ${germanDate(payment.paidOn)} löschen`}
                          >
                            <Trash2 aria-hidden className="size-4" />
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {canManage && invoice.status === "issued" && openCents > 0 ? (
                <PaymentForm invoiceId={invoice.id} openCents={openCents} today={loaded.today} />
              ) : null}
            </CardContent>
          </Card>
          {canManage && invoice.status === "issued" ? (
            <Card>
              <CardHeader>
                <CardTitle>Korrigieren</CardTitle>
                <CardDescription>
                  Ausgestellte Rechnungen bleiben unverändert (§ 11 UStG) und werden 7 Jahre
                  aufbewahrt. Fehler korrigiert eine Stornorechnung.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CancelInvoice invoiceId={invoice.id} number={invoice.number ?? ""} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {delivery ? (
        <Card id="versand" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Versand</CardTitle>
            <CardDescription>
              Per E-Mail mit dem PDF im Anhang und dem Link zur{" "}
              <a
                href={delivery.url}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline underline-offset-4"
              >
                Rechnungsseite
              </a>
              {delivery.firstViewedAt
                ? `, vom Kunden geöffnet am ${germanDate(delivery.firstViewedAt.toISOString().slice(0, 10))}`
                : ""}
              . Zustellung ohne Lesebestätigung.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {delivery.openApprovals > 0 ? (
              <p className="text-sm" role="status">
                Eine Aufgabe wartet auf die Freigabe dieser Rechnung; sie erledigt sich mit dem
                Versand.
              </p>
            ) : null}
            {delivery.emails.length > 0 ? (
              <ul className="grid gap-2 text-sm" aria-label="Gesendete E-Mails">
                {delivery.emails.map((mail) => (
                  <li key={mail.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={EMAIL_STATUS_TONES[mail.status]}>
                      {EMAIL_STATUS_LABELS[mail.status]}
                    </Badge>
                    <span>
                      {germanDate(mail.createdAt.toISOString().slice(0, 10))} an {mail.toAddress}
                    </span>
                    {mail.error ? (
                      <span className="basis-full text-foreground-muted">{mail.error}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {canManage && !prospect.restrictedAt ? (
              <SendInvoice
                invoiceId={invoice.id}
                filename={filename}
                pdfStored={delivery.pdfStored}
                draft={delivery.draft}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {dunning ? (
        <Card id="mahnungen" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Mahnungen</CardTitle>
            <CardDescription>
              Zahlungserinnerung {loaded.settings.billing.dunningDays[0]} Tage nach Fälligkeit,
              Mahnungen nach {loaded.settings.billing.dunningDays[1]} und{" "}
              {loaded.settings.billing.dunningDays[2]} Tagen, jeweils erst nach Ablauf der Frist
              davor. Ablauf, Zinsen und Pauschale in den{" "}
              <Link href="/settings#angebote" className="text-accent underline underline-offset-4">
                Einstellungen
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {dunning.reminders.filter((reminder) => reminder.status === "sent").length > 0 ? (
              <ul className="grid gap-4 text-sm" aria-label="Versendete Mahnungen">
                {dunning.reminders
                  .filter((reminder) => reminder.status === "sent")
                  .map((reminder) => (
                    <li key={reminder.id} className="grid gap-2">
                      <p>
                        <span className="font-medium">{DUNNING_LEVEL_LABELS[reminder.level]}</span>
                        {reminder.sentAt
                          ? ` · gesendet am ${germanDate(localDateString(reminder.sentAt, loaded.settings.notifications.timezone))}`
                          : ""}
                        {` · Frist bis ${germanDate(reminder.deadline)}`}
                      </p>
                      <Claim
                        claim={{
                          ...reminder,
                          totalCents:
                            reminder.openCents + reminder.interestCents + reminder.feeCents,
                        }}
                      />
                      {reminder.emails.map((mail) => (
                        <p key={mail.id} className="flex flex-wrap items-center gap-2">
                          <Badge tone={EMAIL_STATUS_TONES[mail.status]}>
                            {EMAIL_STATUS_LABELS[mail.status]}
                          </Badge>
                          <span>an {mail.toAddress}</span>
                          {mail.error ? (
                            <span className="basis-full text-foreground-muted">{mail.error}</span>
                          ) : null}
                        </p>
                      ))}
                    </li>
                  ))}
              </ul>
            ) : null}
            {dunning.draft ? (
              <section aria-labelledby="dunning-draft-heading" className="grid gap-4">
                <h3 id="dunning-draft-heading" className="text-base font-semibold">
                  {DUNNING_LEVEL_LABELS[dunning.draft.reminder.level]} (Entwurf)
                </h3>
                {dunning.draft.openApproval ? (
                  <p className="text-sm" role="status">
                    Eine Aufgabe wartet auf die Freigabe; sie erledigt sich mit dem Versand.
                  </p>
                ) : null}
                <Claim claim={dunning.draft.claim} />
                {canManage && !prospect.restrictedAt ? (
                  <>
                    <SendReminder
                      // A payment or a new day changes the text; the form starts over with it.
                      key={dunning.draft.claimKey}
                      invoiceId={invoice.id}
                      reminderId={dunning.draft.reminder.id}
                      label={DUNNING_LEVEL_LABELS[dunning.draft.reminder.level]}
                      filename={filename}
                      pdfStored={dunning.draft.pdfStored}
                      claimKey={dunning.draft.claimKey}
                      draft={dunning.draft.mail}
                    />
                    <DiscardReminderButton
                      reminderId={dunning.draft.reminder.id}
                      deadlineDays={loaded.settings.billing.dunningDeadlineDays}
                    />
                  </>
                ) : null}
              </section>
            ) : dunning.next ? (
              <div className="grid gap-3">
                <p className="text-sm">
                  Nächste Stufe: {DUNNING_LEVEL_LABELS[dunning.next.level]},{" "}
                  {dunning.next.dueOn <= loaded.today
                    ? "jetzt fällig"
                    : `planmäßig am ${germanDate(dunning.next.dueOn)}`}
                  {dunning.mode === "off"
                    ? ". Der stündliche Job legt nichts an; Sie bereiten selbst vor."
                    : "."}
                </p>
                {canManage && !prospect.restrictedAt ? (
                  <PrepareReminderButton
                    invoiceId={invoice.id}
                    label={DUNNING_LEVEL_LABELS[dunning.next.level]}
                  />
                ) : null}
              </div>
            ) : !dunning.remindable ? (
              <p className="text-sm text-foreground-muted">Nichts mehr offen.</p>
            ) : (
              <p className="text-sm text-foreground-muted">
                Die letzte Mahnung ist versendet. Weitere Schritte, etwa ein Inkassobüro, liegen bei
                Ihnen.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {draft && canManage ? (
        <details className="justify-self-start">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-danger">
            Entwurf löschen …
          </summary>
          <form action={deleteInvoiceDraftAction} className="mt-3 grid gap-3">
            <input type="hidden" name="id" value={invoice.id} />
            <p className="text-sm">Diesen Rechnungsentwurf endgültig löschen?</p>
            <button
              type="submit"
              className="inline-flex h-11 items-center gap-2 justify-self-start rounded-md bg-danger px-4 text-sm font-medium text-danger-foreground hover:bg-danger-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <Trash2 aria-hidden className="size-4" />
              Endgültig löschen
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
