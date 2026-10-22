import { FileDown } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { exposeThemeCss } from "@/domain/expose/theme";
import { formatIban } from "@/domain/invoices/epc";
import { INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, WITHOUT_VAT } from "@/domain/invoices/schema";
import { germanDate } from "@/domain/invoices/totals";
import { formatCents } from "@/domain/offers/totals";
import { detectBot } from "@/domain/tracking/user-agent";
import { loadPublicInvoice, recordInvoiceView } from "@/server/invoices/send";
import { workspaceForHostParam } from "@/server/sites";
import { ownerDeviceFor } from "@/server/tracking/http";

type Params = Promise<{ host: string; token: string }>;

const load = cache(async (host: string, token: string) => {
  const workspace = await workspaceForHostParam(host);
  if (!workspace) return null;
  const invoice = await loadPublicInvoice(getDb(), workspace.id, token);
  return invoice ? { workspace, invoice } : null;
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { host, token } = await params;
  const data = await load(host, token);
  if (!data) return {};
  return {
    title: { absolute: `${INVOICE_KIND_LABELS[data.invoice.kind]} ${data.invoice.number}` },
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

/**
 * The customer's invoice page `/r/<token>` (§7.10, 7c-2): amounts, due date,
 * bank details and the PDF that was mailed. System connection, scoped to the
 * host's workspace (ADR-0012); nothing on it is tracked beyond the first view.
 */
export default async function PublicInvoicePage({ params }: { params: Params }) {
  const { host, token } = await params;
  const data = await load(host, token);
  if (!data) notFound();
  const { invoice } = data;
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  await recordInvoiceView(getDb(), {
    workspaceId: invoice.workspaceId,
    invoiceId: invoice.invoiceId,
    quiet: detectBot(requestHeaders) !== null || (await ownerDeviceFor(invoice.workspaceId)),
  });
  const { issuer, recipient, totals, settings } = invoice;
  const label = `${INVOICE_KIND_LABELS[invoice.kind]} ${invoice.number}`;
  const open = Math.max(0, totals.dueCents - invoice.paidCents);
  const payable = invoice.kind !== "cancellation" && invoice.status === "issued" && open > 0;
  const withoutVat = WITHOUT_VAT.has(invoice.treatment);

  return (
    <div data-expose-theme lang="de" className="min-h-dvh bg-background text-foreground">
      <style nonce={nonce}>
        {exposeThemeCss({ accent: settings.branding.accentColor, appearance: "auto" })}
      </style>
      <main id="main" className="mx-auto grid max-w-2xl gap-8 px-5 py-12 sm:px-8 sm:py-16">
        <header className="grid gap-3">
          <p className="text-sm font-medium text-accent">{issuer.name}</p>
          <h1 className="font-display text-3xl font-semibold text-balance">{label}</h1>
          <p className="text-foreground-muted">
            {[
              invoice.title,
              invoice.issueDate ? `vom ${germanDate(invoice.issueDate)}` : null,
              `an ${recipient.name}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-sm">
            Stand:{" "}
            <span className="font-medium">{INVOICE_STATUS_LABELS[invoice.displayStatus]}</span>
          </p>
        </header>

        <dl className="grid gap-2 rounded-lg border border-border p-5 tabular-nums">
          {withoutVat ? null : (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-foreground-muted">Netto</dt>
                <dd>{formatCents(totals.netCents)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-foreground-muted">Umsatzsteuer</dt>
                <dd>{formatCents(totals.vatCents)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4 text-lg font-semibold">
            <dt>{totals.deductedCents ? "Zahlbetrag" : "Gesamt"}</dt>
            <dd>{formatCents(totals.dueCents)}</dd>
          </div>
          {invoice.paidCents > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-foreground-muted">Bereits bezahlt</dt>
              <dd>{formatCents(invoice.paidCents)}</dd>
            </div>
          ) : null}
        </dl>

        {payable && issuer.iban ? (
          <section aria-labelledby="zahlung" className="grid gap-2">
            <h2 id="zahlung" className="text-lg font-semibold">
              Zahlung
            </h2>
            <p>
              Bitte überweisen Sie {formatCents(open)}
              {invoice.dueDate ? ` bis ${germanDate(invoice.dueDate)}` : ""}.
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-foreground-muted">Empfänger</dt>
              <dd>{issuer.name}</dd>
              <dt className="text-foreground-muted">IBAN</dt>
              <dd className="font-mono">{formatIban(issuer.iban)}</dd>
              {issuer.bic ? (
                <>
                  <dt className="text-foreground-muted">BIC</dt>
                  <dd className="font-mono">{issuer.bic}</dd>
                </>
              ) : null}
              <dt className="text-foreground-muted">Verwendungszweck</dt>
              <dd>{invoice.number}</dd>
            </dl>
            <p className="text-sm text-foreground-muted">
              Im PDF finden Sie einen QR-Code „Zahlen mit Code“ für Ihre Banking-App.
            </p>
          </section>
        ) : null}

        {invoice.hasPdf ? (
          <a
            href={`/r/${token}/pdf`}
            className="inline-flex h-11 items-center gap-2 justify-self-start rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <FileDown aria-hidden className="size-4" />
            PDF herunterladen
          </a>
        ) : null}

        <footer className="grid gap-2 border-t border-border pt-6 text-sm text-foreground-muted">
          <p>
            Fragen zur Rechnung? {issuer.name}
            {issuer.email ? (
              <>
                {" · "}
                <a href={`mailto:${issuer.email}`} className="underline underline-offset-4">
                  {issuer.email}
                </a>
              </>
            ) : null}
          </p>
          <p className="flex flex-wrap gap-x-4">
            <a
              href="/impressum"
              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
            >
              Impressum
            </a>
            <a
              href="/datenschutz"
              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
            >
              Datenschutz
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
