import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/analytics/filter-bar";
import { KpiTile } from "@/components/analytics/kpi-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollRegion } from "@/components/ui/misc";
import { formatDays } from "@/domain/analytics/business";
import { formatCount, formatEuro, formatPercent } from "@/domain/analytics/format";
import { trend } from "@/domain/analytics/period";
import { loadBusiness } from "@/server/analytics/business";
import { loadOptions, readDashboardParams, type SearchParams } from "@/server/analytics/params";
import { requireCockpit } from "@/server/session";
import { loadWorkspaceSettings } from "@/server/workspaces";

export const metadata: Metadata = { title: "Geschäft · Auswertung" };

const th = "py-2 pr-4 font-medium";
const td = "py-2 pr-4 text-right tabular-nums";

/** Project dashboard (§7.10, 7c-5): offers, revenue, open items and MRR. */
export default async function BusinessAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { workspace, tenant } = await requireCockpit();
  const { period, preset, filter, query } = readDashboardParams(await searchParams);
  const { data, options } = await tenant(async (tx) => {
    const settings = await loadWorkspaceSettings(tx, workspace.id);
    return {
      data: await loadBusiness(tx, workspace.id, filter, period, settings.notifications.timezone),
      options: await loadOptions(tx, workspace.id),
    };
  });
  const { offers: o, previousOffers: po, revenue, previousRevenue } = data;
  const maxRevenue = Math.max(1, ...revenue.byCampaign.map((row) => Math.abs(row.netCents)));

  return (
    <>
      <FilterBar
        period={period}
        preset={preset}
        filter={filter}
        options={options}
        exportHref={`/auswertung/export?teil=geschaeft&${query}`}
      />
      <section aria-labelledby="business-heading" className="grid gap-3">
        <h2 id="business-heading" className="sr-only">
          Kennzahlen zu Angeboten und Umsatz
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Angebotsvolumen"
            value={formatEuro(o.volumeCents, true)}
            trend={trend(o.volumeCents, po.volumeCents)}
            hint={`${formatCount(o.sent)} Angebote versendet; netto, einmalig plus 12 Monate laufend`}
          />
          <KpiTile
            label="Annahmequote"
            value={formatPercent(o.rate)}
            trend={trend(o.rate, po.rate, true)}
            hint={`${formatCount(o.accepted)} von ${formatCount(o.answered)} beantworteten Angeboten angenommen`}
          />
          <KpiTile
            label="Ø Zeit bis zur Annahme"
            value={formatDays(o.avgDays)}
            trend={trend(o.avgDays, po.avgDays)}
            better="down"
            hint="Vom Versand bis zur Online-Annahme"
          />
          <KpiTile
            label="Umsatz"
            value={formatEuro(revenue.netCents, true)}
            trend={trend(revenue.netCents, previousRevenue.netCents)}
            hint={`Netto aus ${formatCount(revenue.invoices)} ausgestellten Rechnungen, Stornos abgezogen`}
          />
          <KpiTile
            label="Offene Posten"
            value={formatEuro(data.open.openCents, true)}
            hint={`${formatCount(data.open.count)} Rechnungen, davon ${formatEuro(data.open.overdueCents, true)} überfällig (aktueller Stand)`}
          />
          <KpiTile
            label="MRR"
            value={formatEuro(data.contracts.mrrCents, true)}
            hint={`Monatlich wiederkehrend, netto, aus ${formatCount(data.contracts.contracts)} laufenden Wartungsverträgen (aktueller Stand)`}
          />
        </dl>
        <p className="text-sm">
          <Link
            href="/rechnungen"
            className="inline-flex min-h-11 items-center text-accent underline-offset-4 hover:underline"
          >
            Zu den Rechnungen
          </Link>
          <span aria-hidden> · </span>
          <Link
            href="/rechnungen/vertraege"
            className="inline-flex min-h-11 items-center text-accent underline-offset-4 hover:underline"
          >
            Zu den Wartungsverträgen
          </Link>
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Umsatz je Kampagne</CardTitle>
          <CardDescription>
            Netto-Umsatz der Rechnungen im Zeitraum, nach der Kampagne, über die der Kunde kam.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {revenue.byCampaign.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              Im Zeitraum wurde keine Rechnung ausgestellt. Wählen Sie einen längeren Zeitraum oder{" "}
              <Link href="/rechnungen" className="text-accent underline-offset-4 hover:underline">
                stellen Sie eine Rechnung aus
              </Link>
              .
            </p>
          ) : (
            <ScrollRegion label="Umsatz je Kampagne">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className={th}>
                      Kampagne
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Rechnungen
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Umsatz netto
                    </th>
                    <th scope="col" className={th}>
                      <span className="sr-only">Anteil</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {revenue.byCampaign.map((row) => (
                    <tr key={row.campaignId ?? "none"} className="border-b border-border last:border-0">
                      <th scope="row" className="py-2 pr-4 font-medium">
                        {row.campaignId ? (
                          <Link
                            href={`/kampagnen/${row.campaignId}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          row.name
                        )}
                      </th>
                      <td className={td}>{formatCount(row.invoices)}</td>
                      <td className={td}>{formatEuro(row.netCents)}</td>
                      <td className="py-2">
                        <div aria-hidden className="h-2 w-24 rounded-sm bg-surface-sunken">
                          <div
                            className="h-2 rounded-sm bg-accent"
                            style={{
                              width: `${Math.round((Math.max(0, row.netCents) / maxRevenue) * 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </CardContent>
      </Card>
    </>
  );
}
