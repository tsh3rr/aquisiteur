import { Download, Receipt, Repeat, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MonthZipButton } from "@/components/invoices/month-zip-button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import {
  INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
} from "@/domain/invoices/schema";
import { DUNNING_LEVEL_LABELS } from "@/domain/invoices/dunning";
import { germanDate } from "@/domain/invoices/totals";
import { formatCents } from "@/domain/offers/totals";
import { localDateString } from "@/domain/tasks";
import { hasReverseCharge, listInvoices, smallBusinessRevenue } from "@/server/invoices/manage";
import { requireCockpit } from "@/server/session";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { LiveRefresh } from "../chat/live-refresh";
import { loadMonthArchiveAction } from "./actions";

export const metadata: Metadata = { title: "Rechnungen" };

type Search = Promise<{ monat?: string }>;

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function monthLabel(month: string) {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return `${MONTHS[index - 1]} ${year}`;
}

/** The last twelve months, newest first, as YYYY-MM. */
function recentMonths(today: string): string[] {
  const [year, month] = today.split("-").map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1 - i, 1));
    return date.toISOString().slice(0, 7);
  });
}

const linkButton =
  "inline-flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export default async function InvoicesPage({ searchParams }: { searchParams: Search }) {
  const { monat } = await searchParams;
  const month = monat && /^\d{4}-(0[1-9]|1[0-2])$/.test(monat) ? monat : undefined;
  const { workspace, tenant } = await requireCockpit();
  const { rows, revenue, settings, today, reverseCharge } = await tenant(async (tx) => {
    const settings = await loadWorkspaceSettings(tx, workspace.id);
    const today = localDateString(new Date(), settings.notifications.timezone);
    return {
      settings,
      today,
      rows: await listInvoices(tx, workspace.id, { month }),
      revenue: await smallBusinessRevenue(tx, workspace.id, Number(today.slice(0, 4))),
      reverseCharge: await hasReverseCharge(tx, workspace.id),
    };
  });
  const open = rows.filter((row) => ["open", "partly_paid", "overdue"].includes(row.status));
  const openCents = open.reduce((total, row) => total + row.dueCents - row.paidCents, 0);
  const overdue = open.filter((row) => row.status === "overdue").length;
  const months = recentMonths(today);

  return (
    <div className="grid gap-6">
      <LiveRefresh events={["invoice.changed"]} />
      <PageHeader
        title="Rechnungen"
        description={
          open.length > 0
            ? `${open.length} offen, zusammen ${formatCents(openCents)}${overdue > 0 ? `, ${overdue} überfällig` : ""}.`
            : "Rechnungen entstehen aus angenommenen Angeboten oder direkt im Projekt."
        }
        actions={
          <Link href="/rechnungen/vertraege" className={linkButton}>
            <Repeat aria-hidden className="size-4" />
            Wartungsverträge
          </Link>
        }
      />

      {settings.billing.taxMode === "small_business" && revenue.guard.message ? (
        <Alert tone={revenue.guard.level === "warning" ? "warning" : "danger"}>
          <span>
            <span className="font-medium">Kleinunternehmergrenze: </span>
            {revenue.guard.message} Umsatz {today.slice(0, 4)} bisher{" "}
            {formatCents(revenue.revenueCents)} brutto.
          </span>
        </Alert>
      ) : null}

      <form className="flex flex-wrap items-end gap-3" aria-label="Zeitraum">
        <label className="grid gap-1.5 text-sm font-medium">
          Monat
          <select
            name="monat"
            defaultValue={month ?? ""}
            className="h-11 rounded-md border border-border-strong bg-surface px-3 text-sm"
          >
            <option value="">Alle</option>
            {months.map((entry) => (
              <option key={entry} value={entry}>
                {monthLabel(entry)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={linkButton}>
          Anzeigen
        </button>
        {month ? (
          <a href={`/rechnungen/export?monat=${month}`} download className={linkButton}>
            <Download aria-hidden className="size-4" />
            CSV für {monthLabel(month)}
          </a>
        ) : null}
        {month && reverseCharge ? (
          <a
            href={`/rechnungen/zm?quartal=${month.slice(0, 4)}-${Math.ceil(Number(month.slice(5)) / 3)}`}
            download
            className={linkButton}
          >
            <Download aria-hidden className="size-4" />
            ZM-Daten Q{Math.ceil(Number(month.slice(5)) / 3)} {month.slice(0, 4)}
          </a>
        ) : null}
        {month ? (
          <MonthZipButton
            month={month}
            label={`ZIP für ${monthLabel(month)}`}
            load={loadMonthArchiveAction}
          />
        ) : null}
      </form>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="grid justify-items-center gap-4 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
              <Receipt aria-hidden className="size-5" />
            </span>
            <div className="grid max-w-md gap-1.5">
              <p className="font-medium">
                {month ? `Keine Rechnungen im ${monthLabel(month)}.` : "Noch keine Rechnungen."}
              </p>
              <p className="text-sm text-foreground-muted">
                Ist ein Angebot angenommen, legt „Rechnungen erstellen“ im Angebot die Anzahlungs-
                und Schlussrechnungen nach dem Zahlungsplan an. Einzelne Rechnungen legen Sie im
                Projekt an.
              </p>
            </div>
            <Link href="/kunden" className={linkButton}>
              <Users aria-hidden className="size-4" />
              Zu den Kunden
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="relative overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Rechnungen</caption>
            <thead className="border-b border-border text-foreground-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Rechnung
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Kunde und Projekt
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  Betrag
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Fällig
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-5 py-3">
                    <Link
                      href={`/rechnungen/${row.id}`}
                      className="grid font-medium hover:text-accent"
                    >
                      {row.number ?? "Entwurf"}
                      <span className="font-normal text-foreground-muted">
                        {INVOICE_KIND_LABELS[row.kind]}
                        {row.issueDate ? ` vom ${germanDate(row.issueDate)}` : ""}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/kunden/${row.prospectId}`} className="grid hover:text-accent">
                      {row.company}
                      <span className="text-foreground-muted">{row.projectName ?? row.title}</span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={INVOICE_STATUS_TONES[row.status]}>
                      {INVOICE_STATUS_LABELS[row.status]}
                    </Badge>
                    {row.dunningLevel && ["open", "partly_paid", "overdue"].includes(row.status) ? (
                      <span className="block pt-1 text-xs text-foreground-muted">
                        {DUNNING_LEVEL_LABELS[row.dunningLevel]} gesendet
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap tabular-nums">
                    {formatCents(row.dueCents)}
                    {row.status === "partly_paid" ? (
                      <span className="block text-xs text-foreground-muted">
                        offen {formatCents(row.dueCents - row.paidCents)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">
                    {row.dueDate && row.kind !== "cancellation" ? germanDate(row.dueDate) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
