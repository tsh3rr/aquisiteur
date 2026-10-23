import { toCsv } from "@/domain/csv";
import { blockLabel, CHANNEL_LABELS, NUDGE_LABELS } from "@/domain/analytics/content";
import { isoDay, lastDay } from "@/domain/analytics/period";
import { loadBusiness } from "@/server/analytics/business";
import { loadContent } from "@/server/analytics/content";
import { loadOverview } from "@/server/analytics/dashboard";
import { readDashboardParams } from "@/server/analytics/params";
import { requireCockpit } from "@/server/session";
import { loadWorkspaceSettings } from "@/server/workspaces";

const percent = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 10);

/** CSV of the dashboard behind the current filters (§7.8 „Export als CSV“). */
export async function GET(request: Request) {
  const { workspace, tenant } = await requireCockpit();
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const { period, filter } = readDashboardParams(raw);
  const part =
    raw.teil === "inhalte" ? "inhalte" : raw.teil === "geschaeft" ? "geschaeft" : "uebersicht";
  const rows = await tenant(async (tx) => {
    if (part === "inhalte") {
      const data = await loadContent(tx, workspace.id, filter, period);
      return [
        ["Bereich", "Name", "Wert 1", "Wert 2", "Wert 3", "Quote (%)"],
        ...data.blocks.map((block) => [
          "Abschnitt (erreicht, Ø Sekunden, verlassen)",
          blockLabel(block.blockType),
          block.views,
          block.avgSeconds === null ? null : Math.round(block.avgSeconds),
          block.exits,
          percent(block.reach),
        ]),
        ...data.channels.map((channel) => [
          "Kanal (angesteuert, geklickt)",
          CHANNEL_LABELS[channel.channel] ?? channel.channel,
          channel.hovers,
          channel.clicks,
          null,
          percent(channel.rate),
        ]),
        ...data.nudges.map((nudge) => [
          "Hinweis (gezeigt, geklickt, geschlossen)",
          NUDGE_LABELS[nudge.nudge] ?? nudge.nudge,
          nudge.shown,
          nudge.clicked,
          nudge.dismissed,
          percent(nudge.clickRate),
        ]),
      ];
    }
    const settings = await loadWorkspaceSettings(tx, workspace.id);
    if (part === "geschaeft") {
      const data = await loadBusiness(
        tx,
        workspace.id,
        filter,
        period,
        settings.notifications.timezone,
      );
      const { offers: o, previousOffers: po } = data;
      const euro = (cents: number) => cents / 100;
      return [
        ["Bereich", "Name", "Zeitraum", "Vorperiode"],
        ["Kennzahl", "Versendete Angebote", o.sent, po.sent],
        ["Kennzahl", "Angebotsvolumen netto (EUR)", euro(o.volumeCents), euro(po.volumeCents)],
        ["Kennzahl", "Annahmequote (%)", percent(o.rate), percent(po.rate)],
        ["Kennzahl", "Ø Tage bis zur Annahme", o.avgDays, po.avgDays],
        [
          "Kennzahl",
          "Umsatz netto (EUR)",
          euro(data.revenue.netCents),
          euro(data.previousRevenue.netCents),
        ],
        ["Stand heute", "Offene Posten (EUR)", euro(data.open.openCents), null],
        ["Stand heute", "Davon überfällig (EUR)", euro(data.open.overdueCents), null],
        ["Stand heute", "MRR netto (EUR)", euro(data.contracts.mrrCents), null],
        ...data.revenue.byCampaign.map((row) => [
          "Umsatz je Kampagne (EUR, Rechnungen)",
          row.name,
          euro(row.netCents),
          row.invoices,
        ]),
      ];
    }
    const data = await loadOverview(
      tx,
      workspace.id,
      filter,
      period,
      settings.notifications.timezone,
    );
    const { current: c, previous: p } = data.kpis;
    const kpi = (label: string, now: number | null, before: number | null) => [
      "Kennzahl",
      label,
      now,
      before,
    ];
    return [
      ["Bereich", "Name", "Zeitraum", "Vorperiode"],
      kpi("Versendete Briefe", c.lettersSent, p.lettersSent),
      kpi("Geöffnet", c.opened, p.opened),
      kpi("Öffnungsrate (%)", percent(c.openRate), percent(p.openRate)),
      kpi("Ø Stunden bis zur Öffnung", c.avgHoursToOpen, p.avgHoursToOpen),
      kpi("Ø Verweildauer (s)", c.avgReadSeconds, p.avgReadSeconds),
      kpi("Besuche", c.visits, p.visits),
      kpi("Kontaktversuche", c.contactAttempts, p.contactAttempts),
      kpi("Kontaktquote (%)", percent(c.contactRate), percent(p.contactRate)),
      kpi("Termine", c.meetings, p.meetings),
      kpi("Gewonnen", c.won, p.won),
      kpi("Kosten (EUR)", c.costCents / 100, p.costCents / 100),
      ["Kennzahl", "Umsatz-Pipeline (EUR)", data.kpis.pipelineCents / 100, null],
      ...data.funnels.all.map((row) => ["Funnel", row.label, row.count, percent(row.rate)]),
      ...data.funnels.campaigns.flatMap((campaign) =>
        campaign.funnel.map((row) => [
          `Funnel ${campaign.name}`,
          row.label,
          row.count,
          percent(row.rate),
        ]),
      ),
      ...data.activity.days.map((day) => ["Besuche pro Tag", day.day, day.visits, day.prospects]),
    ];
  });
  const csv = toCsv(rows);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="auswertung-${part}-${isoDay(period.from)}-${lastDay(period)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
