import "server-only";
import { sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import { buildFunnel, type FunnelRow } from "@/domain/analytics/funnel";
import { previousPeriod, ratio, type Period } from "@/domain/analytics/period";
import { isProspectStatus, type ProspectStatus } from "@/domain/prospects/status";
import {
  CONTACT_EVENTS,
  prospectScope,
  READ_VISIT,
  REAL_VISIT,
  type AnalyticsFilter,
} from "./filters";

/** Dashboard figures (§7.8). Every query runs as tenant and is scoped by `prospectScope`. */

export interface Kpis {
  lettersSent: number;
  opened: number;
  openRate: number | null;
  /** Hours from posting to the first real visit, average. */
  avgHoursToOpen: number | null;
  /** Visible seconds per real visit, average. */
  avgReadSeconds: number | null;
  visits: number;
  visitedProspects: number;
  contactAttempts: number;
  contactRate: number | null;
  meetings: number;
  won: number;
  costCents: number;
  costPerLetterCents: number | null;
  costPerWinCents: number | null;
}

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

async function kpisFor(
  tx: Transaction,
  workspaceId: string,
  filter: AnalyticsFilter,
  period: Period,
): Promise<Kpis> {
  const scope = prospectScope(workspaceId, filter);
  // postgres-js binds raw parameters as text; ISO strings become timestamptz.
  const from = period.from.toISOString();
  const to = period.to.toISOString();
  const [letters] = await tx.execute<{
    sent: string;
    opened: string;
    hours: string | null;
    cost: string | null;
  }>(sql`
    with sent as (
      select l.prospect_id, min(l.posted_at) as posted_at, sum(coalesce(l.cost_cents, 0)) as cost
      from letters l join prospects p on p.workspace_id = l.workspace_id and p.id = l.prospect_id
      where ${scope} and l.workspace_id = ${workspaceId}
        and l.posted_at >= ${from} and l.posted_at < ${to}
      group by l.prospect_id
    ), first_open as (
      select s.prospect_id, s.posted_at, min(v.started_at) as opened_at
      from sent s join visits v on v.workspace_id = ${workspaceId} and v.prospect_id = s.prospect_id
      where ${REAL_VISIT} and v.started_at >= s.posted_at
      group by s.prospect_id, s.posted_at
    )
    select (select count(*) from sent) as sent,
           (select count(*) from first_open) as opened,
           (select avg(extract(epoch from opened_at - posted_at) / 3600) from first_open) as hours,
           (select sum(cost) from sent) as cost`);
  const [letterCount] = await tx.execute<{ letters: string }>(sql`
    select count(*) as letters from letters l
    join prospects p on p.workspace_id = l.workspace_id and p.id = l.prospect_id
    where ${scope} and l.posted_at >= ${from} and l.posted_at < ${to}`);
  const [visits] = await tx.execute<{
    visits: string;
    prospects: string;
    seconds: string | null;
  }>(sql`
    select count(*) as visits, count(distinct v.prospect_id) as prospects,
           avg(v.active_seconds) filter (where v.active_seconds > 0) as seconds
    from visits v join prospects p on p.workspace_id = v.workspace_id and p.id = v.prospect_id
    where ${scope} and ${REAL_VISIT} and v.started_at >= ${from} and v.started_at < ${to}`);
  const [attempts] = await tx.execute<{ prospects: string }>(sql`
    select count(distinct v.prospect_id) as prospects
    from events e
    join visits v on v.workspace_id = e.workspace_id and v.id = e.visit_id
    join prospects p on p.workspace_id = v.workspace_id and p.id = v.prospect_id
    where ${scope} and not v.is_bot and not v.is_internal
      and e.type in ${CONTACT_EVENTS} and e.occurred_at >= ${from} and e.occurred_at < ${to}`);
  const [statuses] = await tx.execute<{ meetings: string; won: string }>(sql`
    select count(distinct a.target_id) filter (where a.meta ->> 'to' = 'meeting') as meetings,
           count(distinct a.target_id) filter (where a.meta ->> 'to' = 'won') as won
    from audit_log a join prospects p on p.workspace_id = a.workspace_id and p.id::text = a.target_id
    where ${scope} and a.action = 'prospect.status_changed' and a.target_type = 'prospect'
      and a.created_at >= ${from} and a.created_at < ${to}`);

  const lettersSent = Number(letterCount?.letters ?? 0);
  const prospectsSent = Number(letters?.sent ?? 0);
  const opened = Number(letters?.opened ?? 0);
  const costCents = Number(letters?.cost ?? 0);
  const won = Number(statuses?.won ?? 0);
  const visitedProspects = Number(visits?.prospects ?? 0);
  const contactAttempts = Number(attempts?.prospects ?? 0);
  return {
    lettersSent,
    opened,
    openRate: ratio(opened, prospectsSent),
    avgHoursToOpen: num(letters?.hours),
    avgReadSeconds: num(visits?.seconds),
    visits: Number(visits?.visits ?? 0),
    visitedProspects,
    contactAttempts,
    contactRate: ratio(contactAttempts, visitedProspects),
    meetings: Number(statuses?.meetings ?? 0),
    won,
    costCents,
    costPerLetterCents: lettersSent > 0 ? Math.round(costCents / lettersSent) : null,
    costPerWinCents: won > 0 ? Math.round(costCents / won) : null,
  };
}

export async function loadKpis(
  tx: Transaction,
  workspaceId: string,
  filter: AnalyticsFilter,
  period: Period,
): Promise<{ current: Kpis; previous: Kpis; pipelineCents: number; openPipeline: number }> {
  const scope = prospectScope(workspaceId, filter);
  const [current, previous, [pipeline]] = await Promise.all([
    kpisFor(tx, workspaceId, filter, period),
    kpisFor(tx, workspaceId, filter, previousPeriod(period)),
    tx.execute<{ cents: string | null; prospects: string }>(sql`
      select sum(p.estimated_value_cents) as cents, count(*) as prospects from prospects p
      where ${scope} and p.status in ('interested', 'contacted', 'meeting')`),
  ]);
  return {
    current,
    previous,
    pipelineCents: Number(pipeline?.cents ?? 0),
    openPipeline: Number(pipeline?.prospects ?? 0),
  };
}

/**
 * Funnel of the prospects whose first letter went out in the period, one
 * row set per campaign when `byCampaign` (comparable between campaigns).
 */
export async function loadFunnels(
  tx: Transaction,
  workspaceId: string,
  filter: AnalyticsFilter,
  period: Period,
): Promise<{
  all: FunnelRow[];
  campaigns: { id: string | null; name: string; funnel: FunnelRow[] }[];
}> {
  const scope = prospectScope(workspaceId, filter);
  const rows = await tx.execute<{
    campaign_id: string | null;
    campaign_name: string | null;
    opened: boolean;
    read: boolean;
    attempt: boolean;
    statuses: string[];
  }>(sql`
    with cohort as (
      select l.prospect_id, min(l.posted_at) as posted_at
      from letters l join prospects p on p.workspace_id = l.workspace_id and p.id = l.prospect_id
      where ${scope} and l.posted_at is not null
      group by l.prospect_id
      having min(l.posted_at) >= ${period.from.toISOString()} and min(l.posted_at) < ${period.to.toISOString()}
    )
    select p.campaign_id, c.name as campaign_name,
      exists (select 1 from visits v where v.workspace_id = p.workspace_id and v.prospect_id = p.id
              and ${REAL_VISIT} and v.started_at >= cohort.posted_at) as opened,
      exists (select 1 from visits v where v.workspace_id = p.workspace_id and v.prospect_id = p.id
              and ${REAL_VISIT} and ${READ_VISIT} and v.started_at >= cohort.posted_at) as read,
      exists (select 1 from events e join visits v on v.workspace_id = e.workspace_id and v.id = e.visit_id
              where v.workspace_id = p.workspace_id and v.prospect_id = p.id
              and not v.is_bot and not v.is_internal and e.type in ${CONTACT_EVENTS}) as attempt,
      to_jsonb(array(select distinct a.meta ->> 'to' from audit_log a
            where a.workspace_id = p.workspace_id and a.target_type = 'prospect'
              and a.target_id = p.id::text and a.action = 'prospect.status_changed')
        || p.status::text) as statuses
    from cohort
    join prospects p on p.workspace_id = ${workspaceId} and p.id = cohort.prospect_id
    left join campaigns c on c.workspace_id = p.workspace_id and c.id = p.campaign_id`);
  const prospects = rows.map((row) => ({
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    opened: row.opened,
    read: row.read,
    attempt: row.attempt,
    statuses: row.statuses.filter((status): status is ProspectStatus => isProspectStatus(status)),
  }));
  const groups = new Map<string | null, { name: string; members: typeof prospects }>();
  for (const prospect of prospects) {
    const group = groups.get(prospect.campaignId) ?? {
      name: prospect.campaignName ?? "Ohne Kampagne",
      members: [],
    };
    group.members.push(prospect);
    groups.set(prospect.campaignId, group);
  }
  return {
    all: buildFunnel(prospects),
    campaigns: [...groups.entries()]
      .map(([id, group]) => ({ id, name: group.name, funnel: buildFunnel(group.members) }))
      .sort((a, b) => a.name.localeCompare(b.name, "de")),
  };
}

export interface ActivityData {
  /** Real visits per day of the period, "YYYY-MM-DD" in the workspace's zone. */
  days: { day: string; visits: number; prospects: number }[];
  /** heatmap[weekday 0 = Monday][hour] = visits. */
  heatmap: number[][];
}

export async function loadActivity(
  tx: Transaction,
  workspaceId: string,
  filter: AnalyticsFilter,
  period: Period,
  timeZone: string,
): Promise<ActivityData> {
  const scope = prospectScope(workspaceId, filter);
  const [days, cells] = await Promise.all([
    tx.execute<{ day: string; visits: string; prospects: string }>(sql`
      select to_char(v.started_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
             count(*) as visits, count(distinct v.prospect_id) as prospects
      from visits v join prospects p on p.workspace_id = v.workspace_id and p.id = v.prospect_id
      where ${scope} and ${REAL_VISIT} and v.started_at >= ${period.from.toISOString()} and v.started_at < ${period.to.toISOString()}
      group by 1 order by 1`),
    tx.execute<{ dow: number; hour: number; visits: string }>(sql`
      select extract(isodow from v.started_at at time zone ${timeZone})::int as dow,
             extract(hour from v.started_at at time zone ${timeZone})::int as hour,
             count(*) as visits
      from visits v join prospects p on p.workspace_id = v.workspace_id and p.id = v.prospect_id
      where ${scope} and ${REAL_VISIT} and v.started_at >= ${period.from.toISOString()} and v.started_at < ${period.to.toISOString()}
      group by 1, 2`),
  ]);
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const cell of cells) heatmap[cell.dow - 1]![cell.hour] = Number(cell.visits);
  return {
    days: days.map((row) => ({
      day: row.day,
      visits: Number(row.visits),
      prospects: Number(row.prospects),
    })),
    heatmap,
  };
}

/** Distinct industries and cities for the filter selects. */
export async function loadFilterOptions(tx: Transaction, workspaceId: string) {
  const [industries, cities, tags] = await Promise.all([
    tx.execute<{ value: string }>(
      sql`select distinct industry as value from prospects where workspace_id = ${workspaceId} and industry is not null order by 1 limit 100`,
    ),
    tx.execute<{ value: string }>(
      sql`select distinct city as value from prospects where workspace_id = ${workspaceId} and city is not null order by 1 limit 200`,
    ),
    tx.execute<{ value: string }>(
      sql`select distinct unnest(tags) as value from prospects where workspace_id = ${workspaceId} order by 1 limit 200`,
    ),
  ]);
  return {
    industries: industries.map((row) => row.value),
    cities: cities.map((row) => row.value),
    tags: tags.map((row) => row.value),
  };
}
