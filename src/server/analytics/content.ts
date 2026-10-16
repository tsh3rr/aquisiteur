import "server-only";
import { sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import { ratio, type Period } from "@/domain/analytics/period";
import { prospectScope, REAL_VISIT, type AnalyticsFilter } from "./filters";

export interface BlockStats {
  blockType: string;
  /** Visits that saw the section. */
  views: number;
  reach: number | null;
  /** Average visible seconds among visits that stayed on it. */
  avgSeconds: number | null;
  /** Visits whose last seen section was this one. */
  exits: number;
  exitRate: number | null;
}

export interface ChannelStats {
  channel: string;
  hovers: number;
  clicks: number;
  /** Clicks per visit that saw the contact section. */
  rate: number | null;
}

export interface NudgeStats {
  nudge: string;
  shown: number;
  clicked: number;
  dismissed: number;
  clickRate: number | null;
}

export interface ContentData {
  visits: number;
  contactViews: number;
  blocks: BlockStats[];
  channels: ChannelStats[];
  nudges: NudgeStats[];
}

/** Which sections are read, where readers leave, which channels and nudges work. */
export async function loadContent(
  tx: Transaction,
  workspaceId: string,
  filter: AnalyticsFilter,
  period: Period,
): Promise<ContentData> {
  const scope = prospectScope(workspaceId, filter);
  // Real visits of the period; every query below starts from this set.
  const scoped = sql`
    select v.id from visits v join prospects p on p.workspace_id = v.workspace_id and p.id = v.prospect_id
    where ${scope} and ${REAL_VISIT} and v.started_at >= ${period.from.toISOString()} and v.started_at < ${period.to.toISOString()}`;
  const inScope = sql`e.workspace_id = ${workspaceId} and e.visit_id in (${scoped})`;
  const [[totals], blocks, exits, channels, nudges] = await Promise.all([
    tx.execute<{ visits: string; contact: string }>(sql`
      select (select count(*) from (${scoped}) s) as visits,
             (select count(distinct e.visit_id) from events e
              where ${inScope} and e.type = 'section_view' and e.payload ->> 'blockType' = 'contact') as contact`),
    tx.execute<{ block_type: string; views: string; seconds: string | null }>(sql`
      with per_visit as (
        select e.payload ->> 'blockType' as block_type, e.visit_id,
               bool_or(e.type = 'section_view') as seen,
               sum(case when e.type = 'section_dwell' then (e.payload ->> 'seconds')::int else 0 end) as seconds
        from events e
        where ${inScope} and e.type in ('section_view', 'section_dwell') and e.payload ? 'blockType'
        group by 1, 2
      )
      select block_type, count(*) filter (where seen) as views,
             avg(seconds) filter (where seconds > 0) as seconds
      from per_visit group by 1`),
    tx.execute<{ block_type: string; exits: string }>(sql`
      select block_type, count(*) as exits from (
        select distinct on (e.visit_id) e.visit_id, e.payload ->> 'blockType' as block_type
        from events e
        where ${inScope} and e.type = 'section_view' and e.payload ? 'blockType'
        order by e.visit_id, e.occurred_at desc
      ) last_seen group by 1`),
    tx.execute<{ channel: string; hovers: string; clicks: string }>(sql`
      -- One per channel and visit: three taps on "Anrufen" are one call.
      select channel, count(distinct visit_id) filter (where kind = 'hover') as hovers,
             count(distinct visit_id) filter (where kind = 'click') as clicks
      from (
        select case when e.type = 'cta_hover' then 'hover' else 'click' end as kind,
               case e.type
                 when 'chat_message_sent' then 'chat'
                 when 'callback_submitted' then 'callback'
                 else e.payload ->> 'channel' end as channel,
               e.visit_id
        from events e
        where ${inScope}
          and e.type in ('cta_hover', 'contact_click', 'chat_message_sent', 'callback_submitted')
      ) c
      where channel is not null
      group by channel`),
    tx.execute<{ nudge: string; shown: string; clicked: string; dismissed: string }>(sql`
      select e.payload ->> 'nudge' as nudge,
             count(distinct e.visit_id) filter (where e.type = 'nudge_shown') as shown,
             count(distinct e.visit_id) filter (where e.type = 'nudge_clicked') as clicked,
             count(distinct e.visit_id) filter (where e.type = 'nudge_dismissed') as dismissed
      from events e
      where ${inScope} and e.type in ('nudge_shown', 'nudge_clicked', 'nudge_dismissed')
      group by 1`),
  ]);
  const visits = Number(totals?.visits ?? 0);
  const contactViews = Number(totals?.contact ?? 0);
  const exitMap = new Map(exits.map((row) => [row.block_type, Number(row.exits)]));
  return {
    visits,
    contactViews,
    blocks: blocks
      .map((row) => {
        const views = Number(row.views);
        const blockExits = exitMap.get(row.block_type) ?? 0;
        return {
          blockType: row.block_type,
          views,
          reach: ratio(views, visits),
          avgSeconds: row.seconds === null ? null : Number(row.seconds),
          exits: blockExits,
          exitRate: ratio(blockExits, views),
        };
      })
      .sort((a, b) => b.views - a.views),
    channels: channels
      .map((row) => ({
        channel: row.channel,
        hovers: Number(row.hovers),
        clicks: Number(row.clicks),
        rate: ratio(Number(row.clicks), contactViews),
      }))
      .sort((a, b) => b.clicks - a.clicks),
    nudges: nudges
      .map((row) => ({
        nudge: row.nudge,
        shown: Number(row.shown),
        clicked: Number(row.clicked),
        dismissed: Number(row.dismissed),
        clickRate: ratio(Number(row.clicked), Number(row.shown)),
      }))
      .sort((a, b) => b.shown - a.shown),
  };
}
