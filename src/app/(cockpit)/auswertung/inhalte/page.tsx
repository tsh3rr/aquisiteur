import type { Metadata } from "next";
import { FilterBar } from "@/components/analytics/filter-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollRegion } from "@/components/ui/misc";
import { blockLabel, CHANNEL_LABELS, NUDGE_LABELS } from "@/domain/analytics/content";
import { formatCount, formatPercent, formatSeconds } from "@/domain/analytics/format";
import { loadContent } from "@/server/analytics/content";
import { loadOptions, readDashboardParams, type SearchParams } from "@/server/analytics/params";
import { requireCockpit } from "@/server/session";

export const metadata: Metadata = { title: "Inhalte · Auswertung" };

function Bar({ value }: { value: number | null }) {
  return (
    <div aria-hidden className="h-2 w-24 rounded-sm bg-surface-sunken">
      <div
        className="h-2 rounded-sm bg-accent"
        style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
      />
    </div>
  );
}

const th = "py-2 pr-4 font-medium";
const td = "py-2 pr-4 tabular-nums";

export default async function ContentAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { workspace, tenant } = await requireCockpit();
  const { period, preset, filter, query } = readDashboardParams(await searchParams);
  const { data, options } = await tenant(async (tx) => ({
    data: await loadContent(tx, workspace.id, filter, period),
    options: await loadOptions(tx, workspace.id),
  }));
  const maxSeconds = Math.max(1, ...data.blocks.map((block) => block.avgSeconds ?? 0));

  return (
    <>
      <FilterBar
        period={period}
        preset={preset}
        filter={filter}
        options={options}
        exportHref={`/auswertung/export?teil=inhalte&${query}`}
      />
      {data.visits === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-foreground-muted">
            Im Zeitraum gab es keine echten Besuche. Wählen Sie einen längeren Zeitraum oder weniger
            Filter.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Abschnitte</CardTitle>
              <CardDescription>
                Wie viele Leser einen Abschnitt erreichen, wie lange sie bleiben und wo sie das
                Exposé verlassen. Grundlage: {formatCount(data.visits)} Besuche.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollRegion label="Abschnitte">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className={th}>
                        Abschnitt
                      </th>
                      <th scope="col" className={th}>
                        Erreicht
                      </th>
                      <th scope="col" className={th}>
                        Ø Lesezeit
                      </th>
                      <th scope="col" className={th}>
                        Hier verlassen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.blocks.map((block) => (
                      <tr key={block.blockType} className="border-b border-border last:border-0">
                        <th scope="row" className={`${th} font-normal`}>
                          {blockLabel(block.blockType)}
                        </th>
                        <td className={td}>
                          <div className="flex items-center gap-3">
                            <Bar value={block.reach} />
                            {formatPercent(block.reach)}
                          </div>
                        </td>
                        <td className={td}>
                          <div className="flex items-center gap-3">
                            <Bar value={(block.avgSeconds ?? 0) / maxSeconds} />
                            {formatSeconds(block.avgSeconds)}
                          </div>
                        </td>
                        <td className={td}>
                          {formatPercent(block.exitRate)}{" "}
                          <span className="text-foreground-muted">
                            ({formatCount(block.exits)})
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            </CardContent>
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Kontaktkanäle</CardTitle>
                <CardDescription>
                  Klickrate bezogen auf die {formatCount(data.contactViews)} Besuche, die den
                  Kontaktbereich gesehen haben.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.channels.length === 0 ? (
                  <p className="text-sm text-foreground-muted">Noch keine Kanäle angeklickt.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className={th}>
                          Kanal
                        </th>
                        <th scope="col" className={th}>
                          Angesteuert
                        </th>
                        <th scope="col" className={th}>
                          Geklickt
                        </th>
                        <th scope="col" className={th}>
                          Klickrate
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.channels.map((channel) => (
                        <tr key={channel.channel} className="border-b border-border last:border-0">
                          <th scope="row" className={`${th} font-normal`}>
                            {CHANNEL_LABELS[channel.channel] ?? channel.channel}
                          </th>
                          <td className={td}>{formatCount(channel.hovers)}</td>
                          <td className={td}>{formatCount(channel.clicks)}</td>
                          <td className={td}>{formatPercent(channel.rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Hinweise (Nudges)</CardTitle>
                <CardDescription>
                  Wie oft ein Hinweis gezeigt, geklickt oder geschlossen wurde.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.nudges.length === 0 ? (
                  <p className="text-sm text-foreground-muted">Noch keine Hinweise gezeigt.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className={th}>
                          Hinweis
                        </th>
                        <th scope="col" className={th}>
                          Gezeigt
                        </th>
                        <th scope="col" className={th}>
                          Geklickt
                        </th>
                        <th scope="col" className={th}>
                          Geschlossen
                        </th>
                        <th scope="col" className={th}>
                          Klickrate
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.nudges.map((nudge) => (
                        <tr key={nudge.nudge} className="border-b border-border last:border-0">
                          <th scope="row" className={`${th} font-normal`}>
                            {NUDGE_LABELS[nudge.nudge] ?? nudge.nudge}
                          </th>
                          <td className={td}>{formatCount(nudge.shown)}</td>
                          <td className={td}>{formatCount(nudge.clicked)}</td>
                          <td className={td}>{formatCount(nudge.dismissed)}</td>
                          <td className={td}>{formatPercent(nudge.clickRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
