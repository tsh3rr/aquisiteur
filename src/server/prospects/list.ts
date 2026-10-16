import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  max,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { Transaction } from "@/db";
import { exposes, intentScores, prospects, savedViews, visits } from "@/db/schema";
import type { IntentLevel } from "@/domain/intent/score";
import type { ListQuery } from "@/domain/prospects/list-query";

export const LIST_LIMIT = 500;

const ACTIVITY_HOURS = { "24h": 24, "7d": 7 * 24, "30d": 30 * 24 } as const;

/** Real visits only: confirmed by the page, not a bot, not the owner. */
export function realVisit() {
  return and(isNotNull(visits.confirmedAt), eq(visits.isBot, false), eq(visits.isInternal, false));
}

export interface ProspectRow {
  id: string;
  companyName: string;
  city: string | null;
  status: (typeof prospects.$inferSelect)["status"];
  tags: string[];
  email: string | null;
  phone: string | null;
  website: string | null;
  createdAt: Date;
  lastActivityAt: Date | null;
  visitCount: number;
  exposeSlug: string | null;
  score: number | null;
  level: IntentLevel | null;
}

/** The customer list (§7.8), filtered and sorted as in the URL. Runs as tenant. */
export async function listProspects(
  tx: Transaction,
  workspaceId: string,
  query: ListQuery,
  limit = LIST_LIMIT,
): Promise<ProspectRow[]> {
  const activity = tx
    .select({
      prospectId: visits.prospectId,
      last: max(visits.lastSeenAt).as("last"),
      visitCount: count().as("visit_count"),
    })
    .from(visits)
    .where(and(eq(visits.workspaceId, workspaceId), realVisit()))
    .groupBy(visits.prospectId)
    .as("activity");

  const filters: (SQL | undefined)[] = [eq(prospects.workspaceId, workspaceId)];
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    filters.push(
      or(
        ilike(prospects.companyName, pattern),
        ilike(prospects.city, pattern),
        ilike(prospects.email, pattern),
        ilike(prospects.key, pattern),
      ),
    );
  }
  if (query.statuses.length > 0) filters.push(inArray(prospects.status, query.statuses));
  if (query.tag) filters.push(sql`${prospects.tags} @> array[${query.tag}]::text[]`);
  if (query.activity === "never") filters.push(isNull(activity.last));
  else if (query.activity) {
    const since = new Date(Date.now() - ACTIVITY_HOURS[query.activity] * 3600 * 1000);
    filters.push(gte(activity.last, since));
  }

  const direction = query.dir === "asc" ? asc : desc;
  const order = {
    activity: [sql`${activity.last} ${sql.raw(query.dir === "asc" ? "asc" : "desc")} nulls last`],
    score: [
      sql`${intentScores.score} ${sql.raw(query.dir === "asc" ? "asc" : "desc")} nulls last`,
      desc(intentScores.lastSignalAt),
    ],
    company: [direction(prospects.companyName)],
    status: [direction(prospects.status)],
    city: [direction(prospects.city)],
    created: [direction(prospects.createdAt)],
  }[query.sort];

  const rows = await tx
    .select({
      id: prospects.id,
      companyName: prospects.companyName,
      city: prospects.city,
      status: prospects.status,
      tags: prospects.tags,
      email: prospects.email,
      phone: prospects.phone,
      website: prospects.website,
      createdAt: prospects.createdAt,
      lastActivityAt: activity.last,
      visitCount: activity.visitCount,
      exposeSlug: exposes.slug,
      score: intentScores.score,
      level: intentScores.level,
    })
    .from(prospects)
    .leftJoin(activity, eq(activity.prospectId, prospects.id))
    .leftJoin(
      intentScores,
      and(
        eq(intentScores.workspaceId, prospects.workspaceId),
        eq(intentScores.prospectId, prospects.id),
      ),
    )
    .leftJoin(
      exposes,
      and(eq(exposes.workspaceId, prospects.workspaceId), eq(exposes.prospectId, prospects.id)),
    )
    .where(and(...filters))
    .orderBy(...order, asc(prospects.companyName))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt) : null,
    visitCount: Number(row.visitCount ?? 0),
  }));
}

export async function listTags(tx: Transaction, workspaceId: string): Promise<string[]> {
  const rows = await tx.execute<{ tag: string }>(
    sql`select distinct unnest(tags) as tag from prospects where workspace_id = ${workspaceId} order by 1 limit 200`,
  );
  return rows.map((row) => row.tag);
}

export async function listSavedViews(tx: Transaction, workspaceId: string, userId: string) {
  return tx
    .select({
      id: savedViews.id,
      name: savedViews.name,
      query: savedViews.query,
      userId: savedViews.userId,
    })
    .from(savedViews)
    .where(
      and(
        eq(savedViews.workspaceId, workspaceId),
        or(isNull(savedViews.userId), eq(savedViews.userId, userId)),
      ),
    )
    .orderBy(asc(savedViews.position), asc(savedViews.createdAt));
}
