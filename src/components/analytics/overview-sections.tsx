import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollRegion } from "@/components/ui/misc";
import {
  formatCount,
  formatEuro,
  formatHours,
  formatPercent,
  formatSeconds,
} from "@/domain/analytics/format";
import type { FunnelRow } from "@/domain/analytics/funnel";
import { trend } from "@/domain/analytics/period";
import type { ActivityData, Kpis } from "@/server/analytics/overview";
import { DailyChart } from "./daily-chart";
import { FunnelChart } from "./funnel-chart";
import { Heatmap } from "./heatmap";
import { KpiTile } from "./kpi-tile";

export interface OverviewData {
  kpis: { current: Kpis; previous: Kpis; pipelineCents: number; openPipeline: number };
  funnels: {
    all: FunnelRow[];
    campaigns: { id: string | null; name: string; funnel: FunnelRow[] }[];
  };
  activity: ActivityData;
  days: string[];
}

/** KPI tiles, funnel, activity and heatmap; used by /auswertung and each campaign. */
export function OverviewSections({
  data,
  compareCampaigns,
}: {
  data: OverviewData;
  compareCampaigns: boolean;
}) {
  const { current: c, previous: p } = data.kpis;
  const byDay = new Map(data.activity.days.map((day) => [day.day, day]));
  const points = data.days.map((day) => byDay.get(day) ?? { day, visits: 0, prospects: 0 });
  return (
    <>
      <section aria-labelledby="kpi-heading" className="grid gap-3">
        <h2 id="kpi-heading" className="sr-only">
          Kennzahlen
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Versendete Briefe"
            value={formatCount(c.lettersSent)}
            trend={trend(c.lettersSent, p.lettersSent)}
          />
          <KpiTile
            label="Öffnungsrate"
            value={formatPercent(c.openRate)}
            trend={trend(c.openRate, p.openRate, true)}
            hint={`${formatCount(c.opened)} Kunden haben ihr Exposé geöffnet`}
          />
          <KpiTile
            label="Ø Zeit bis zur Öffnung"
            value={formatHours(c.avgHoursToOpen)}
            trend={trend(c.avgHoursToOpen, p.avgHoursToOpen)}
            better="down"
          />
          <KpiTile
            label="Ø Verweildauer"
            value={formatSeconds(c.avgReadSeconds)}
            trend={trend(c.avgReadSeconds, p.avgReadSeconds)}
            hint={`${formatCount(c.visits)} Besuche von ${formatCount(c.visitedProspects)} Kunden`}
          />
          <KpiTile
            label="Kontaktversuche"
            value={formatCount(c.contactAttempts)}
            trend={trend(c.contactAttempts, p.contactAttempts)}
            hint="Klick auf einen Kanal, Chat-Nachricht oder Rückrufwunsch"
          />
          <KpiTile
            label="Kontaktquote"
            value={formatPercent(c.contactRate)}
            trend={trend(c.contactRate, p.contactRate, true)}
            hint="Anteil der Besucher mit Kontaktversuch"
          />
          <KpiTile
            label="Termine"
            value={formatCount(c.meetings)}
            trend={trend(c.meetings, p.meetings)}
          />
          <KpiTile
            label="Gewonnene Kunden"
            value={formatCount(c.won)}
            trend={trend(c.won, p.won)}
          />
          <KpiTile
            label="Umsatz-Pipeline"
            value={formatEuro(data.kpis.pipelineCents, true)}
            hint={`${formatCount(data.kpis.openPipeline)} offene Kunden mit geschätztem Auftragswert (aktueller Stand)`}
          />
          <KpiTile
            label="Kosten pro Brief"
            value={formatEuro(c.costPerLetterCents)}
            trend={trend(c.costPerLetterCents, p.costPerLetterCents)}
            better="down"
            hint={`${formatEuro(c.costCents)} insgesamt`}
          />
          <KpiTile
            label="Kosten pro Abschluss"
            value={formatEuro(c.costPerWinCents)}
            trend={trend(c.costPerWinCents, p.costPerWinCents)}
            better="down"
          />
        </dl>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Funnel</CardTitle>
            <CardDescription>
              Kunden, deren erster Brief im Zeitraum versendet wurde, und wie weit sie gekommen
              sind.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.funnels.all[0]?.count ? (
              <FunnelChart rows={data.funnels.all} label="Funnel aller Kunden" />
            ) : (
              <p className="text-sm text-foreground-muted">
                Im Zeitraum wurden keine Briefe als versendet markiert.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Besuche pro Tag</CardTitle>
            <CardDescription>Echte Besuche, ohne Bots und Ihre eigenen Geräte.</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyChart points={points} label="Besuche pro Tag" />
          </CardContent>
        </Card>
      </div>

      {compareCampaigns && data.funnels.campaigns.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Kampagnen im Vergleich</CardTitle>
            <CardDescription>
              Anteil der angeschriebenen Kunden, die die jeweilige Stufe erreicht haben.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollRegion label="Kampagnenvergleich">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Kampagne
                    </th>
                    {data.funnels.all.map((row) => (
                      <th key={row.stage} scope="col" className="py-2 pr-3 text-right font-medium">
                        {row.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.funnels.campaigns.map((campaign) => (
                    <tr
                      key={campaign.id ?? "none"}
                      className="border-b border-border last:border-0"
                    >
                      <th scope="row" className="py-2 pr-3 font-medium">
                        {campaign.name}
                      </th>
                      {campaign.funnel.map((row) => (
                        <td key={row.stage} className="py-2 pr-3 text-right tabular-nums">
                          {row.stage === "sent" ? formatCount(row.count) : formatPercent(row.rate)}
                          {row.stage === "sent" ? null : (
                            <span className="block text-xs text-foreground-muted">
                              {formatCount(row.count)}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Wann gelesen wird</CardTitle>
          <CardDescription>
            Besuche nach Wochentag und Uhrzeit. Ein guter Hinweis, wann sich ein Anruf lohnt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Heatmap data={data.activity.heatmap} caption="Besuche nach Wochentag und Uhrzeit" />
        </CardContent>
      </Card>
    </>
  );
}
