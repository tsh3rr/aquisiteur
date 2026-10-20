import "server-only";
import { and, asc, desc, eq, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Transaction } from "@/db";
import { campaigns, contacts, exposes, prospects } from "@/db/schema";
import { STATUS_LABELS } from "@/domain/prospects/status";
import {
  likePattern,
  normalize,
  scoreText,
  SEARCH_GROUP_LIMIT,
  type SearchHit,
} from "@/domain/search";

/**
 * Same folding as `normalize()` in SQL: lower case, umlauts to ae/oe/ue/ss,
 * common accents dropped. Keeps "mueller" and "Müller" together without an
 * extension (plain Postgres only).
 */
function folded(column: AnyColumn | SQL): SQL {
  return sql`replace(replace(replace(replace(translate(lower(coalesce(${column}, '')), 'áàâãåéèêëíìîïóòôõúùûçñ', 'aaaaaeeeeiiiioooouuucn'), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')`;
}

/** Folded column matches every query word (in either umlaut spelling). */
function matchesAll(words: string[], columns: (AnyColumn | SQL)[]): SQL {
  const haystack = sql.join(
    columns.map((column) => folded(column)),
    sql` || ' ' || `,
  );
  const shortHaystack = sql`replace(replace(replace(${haystack}, 'ae', 'a'), 'oe', 'o'), 'ue', 'u')`;
  return and(
    ...words.map((word) => {
      const short = word.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
      return or(
        sql`${haystack} like ${likePattern(word)}`,
        sql`${shortHaystack} like ${likePattern(short)}`,
      );
    }),
  )!;
}

function byScore(query: string, hits: SearchHit[]): SearchHit[] {
  return hits
    .map((hit, index) => ({ hit, index, score: scoreText(query, hit.title) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, SEARCH_GROUP_LIMIT)
    .map((entry) => entry.hit);
}

/**
 * Global search (§7.8) over the workspace's prospects (incl. their contact
 * people), exposés and campaigns. Runs as tenant, so RLS keeps it inside the
 * workspace; the explicit workspace filters are the second fence.
 */
export async function searchWorkspace(
  tx: Transaction,
  workspaceId: string,
  query: string,
): Promise<SearchHit[]> {
  const words = normalize(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  // Fetch more than shown so the ranking below can pick the best.
  const fetch = SEARCH_GROUP_LIMIT * 3;

  // Contact people (first, last name, e-mail) of each prospect, as one string.
  const people = sql`(select string_agg(concat_ws(' ', ${contacts.firstName}, ${contacts.lastName}, ${contacts.email}), ' ') from ${contacts} where ${contacts.workspaceId} = ${prospects.workspaceId} and ${contacts.prospectId} = ${prospects.id})`;

  // Sequential: one transaction runs one query at a time anyway.
  const prospectRows = await tx
    .select({
      id: prospects.id,
      companyName: prospects.companyName,
      city: prospects.city,
      status: prospects.status,
    })
    .from(prospects)
    .where(
      and(
        eq(prospects.workspaceId, workspaceId),
        matchesAll(words, [
          prospects.companyName,
          prospects.city,
          prospects.industry,
          prospects.email,
          prospects.phone,
          prospects.key,
          people,
        ]),
      ),
    )
    .orderBy(desc(prospects.updatedAt))
    .limit(fetch);
  const exposeRows = await tx
    .select({
      id: exposes.id,
      title: exposes.title,
      refCode: exposes.refCode,
      companyName: prospects.companyName,
      unpublishedAt: exposes.unpublishedAt,
    })
    .from(exposes)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, exposes.workspaceId), eq(prospects.id, exposes.prospectId)),
    )
    .where(
      and(
        eq(exposes.workspaceId, workspaceId),
        matchesAll(words, [exposes.title, exposes.refCode, prospects.companyName]),
      ),
    )
    .orderBy(desc(exposes.updatedAt))
    .limit(fetch);
  const campaignRows = await tx
    .select({ id: campaigns.id, name: campaigns.name, archivedAt: campaigns.archivedAt })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.workspaceId, workspaceId),
        matchesAll(words, [campaigns.name, campaigns.description]),
      ),
    )
    .orderBy(sql`${campaigns.archivedAt} is not null`, asc(campaigns.name))
    .limit(fetch);

  return [
    ...byScore(
      query,
      prospectRows.map((row) => ({
        kind: "prospect" as const,
        id: row.id,
        title: row.companyName,
        detail: [row.city, STATUS_LABELS[row.status]].filter(Boolean).join(" · "),
        href: `/kunden/${row.id}`,
      })),
    ),
    ...byScore(
      query,
      exposeRows.map((row) => ({
        kind: "expose" as const,
        id: row.id,
        title: row.title,
        detail: [row.companyName, `Ref ${row.refCode}`, row.unpublishedAt ? "offline" : null]
          .filter(Boolean)
          .join(" · "),
        href: `/exposes/${row.id}`,
      })),
    ),
    ...byScore(
      query,
      campaignRows.map((row) => ({
        kind: "campaign" as const,
        id: row.id,
        title: row.name,
        detail: row.archivedAt ? "archiviert" : null,
        href: `/kampagnen/${row.id}`,
      })),
    ),
  ];
}
