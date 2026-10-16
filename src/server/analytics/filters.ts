import { sql, type SQL } from "drizzle-orm";

/** Dashboard filters (§7.8): Kampagne, Branche, Region (Ort/PLZ), Tag. */
export interface AnalyticsFilter {
  campaignId: string | null;
  industry: string | null;
  /** City name or postal-code prefix, e.g. "Leipzig" or "04". */
  region: string | null;
  tag: string | null;
}

export const NO_FILTER: AnalyticsFilter = {
  campaignId: null,
  industry: null,
  region: null,
  tag: null,
};

const UUID = /^[0-9a-f-]{36}$/i;

export function parseFilter(params: Record<string, string | undefined>): AnalyticsFilter {
  const text = (value: string | undefined, max: number) => value?.trim().slice(0, max) || null;
  return {
    campaignId: UUID.test(params.kampagne ?? "") ? params.kampagne!.toLowerCase() : null,
    industry: text(params.branche, 100),
    region: text(params.region, 100),
    tag: text(params.tag, 40),
  };
}

/** Conditions on the prospects table aliased as `p`. */
export function prospectScope(workspaceId: string, filter: AnalyticsFilter): SQL {
  const parts: SQL[] = [sql`p.workspace_id = ${workspaceId}`];
  if (filter.campaignId) parts.push(sql`p.campaign_id = ${filter.campaignId}`);
  if (filter.industry) parts.push(sql`p.industry = ${filter.industry}`);
  if (filter.region) {
    const region = filter.region;
    parts.push(
      /^\d+$/.test(region)
        ? sql`p.postal_code like ${`${region}%`}`
        : sql`lower(p.city) = lower(${region})`,
    );
  }
  if (filter.tag) parts.push(sql`p.tags @> array[${filter.tag}]::text[]`);
  return sql.join(parts, sql` and `);
}

/** A real visit: the page reported in, no bot, not the owner (alias `v`). */
export const REAL_VISIT = sql`v.confirmed_at is not null and not v.is_bot and not v.is_internal`;

/** "Read": two minutes visible or three quarters scrolled, as in the score (§7.6). */
export const READ_VISIT = sql`(v.active_seconds >= 120 or v.max_scroll >= 75)`;

export const CONTACT_EVENTS = sql`('contact_click', 'chat_message_sent', 'callback_submitted')`;
