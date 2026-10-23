import "server-only";
import { and, eq, inArray, isNotNull, max, type SQL } from "drizzle-orm";
import type { Database, Transaction } from "@/db";
import { exposes, exposeVersions, letters, visits } from "@/db/schema";
import { expiryState, lastActivity, type ExpiryState } from "@/domain/expose/expiry";
import type { ExposeExpirySettings } from "@/domain/workspace-settings";

type Reader = Database | Transaction;

export interface ExposeExpiry extends ExpiryState {
  lastActivityAt: Date;
}

/**
 * Expiry of the workspace's exposés (§7.3, ADR-0078), all of them or the
 * given ones. Works on the system connection and as tenant alike because
 * every query is scoped to the workspace.
 */
export async function exposeExpiries(
  db: Reader,
  workspaceId: string,
  settings: ExposeExpirySettings,
  options: { exposeIds?: string[]; now?: Date } = {},
): Promise<Map<string, ExposeExpiry>> {
  const now = options.now ?? new Date();
  const result = new Map<string, ExposeExpiry>();
  const only = (column: typeof exposes.id | typeof visits.exposeId): SQL | undefined =>
    options.exposeIds ? inArray(column, options.exposeIds) : undefined;
  if (options.exposeIds?.length === 0) return result;
  const rows = await db
    .select({
      id: exposes.id,
      prospectId: exposes.prospectId,
      resetAt: exposes.expiryResetAt,
      publishedAt: exposeVersions.createdAt,
    })
    .from(exposes)
    .leftJoin(
      exposeVersions,
      and(
        eq(exposeVersions.id, exposes.currentVersionId),
        eq(exposeVersions.workspaceId, exposes.workspaceId),
      ),
    )
    .where(and(eq(exposes.workspaceId, workspaceId), only(exposes.id)));
  if (rows.length === 0) return result;
  if (!settings.enabled) {
    for (const row of rows)
      result.set(row.id, { expired: false, expiresAt: null, lastActivityAt: now });
    return result;
  }
  const [visitRows, letterRows] = await Promise.all([
    db
      .select({ exposeId: visits.exposeId, at: max(visits.startedAt) })
      .from(visits)
      .where(
        and(
          eq(visits.workspaceId, workspaceId),
          only(visits.exposeId),
          isNotNull(visits.confirmedAt),
          eq(visits.isBot, false),
          eq(visits.isInternal, false),
          eq(visits.onExpiredPage, false),
        ),
      )
      .groupBy(visits.exposeId),
    db
      .select({ prospectId: letters.prospectId, at: max(letters.postedAt) })
      .from(letters)
      .where(
        and(
          eq(letters.workspaceId, workspaceId),
          inArray(
            letters.prospectId,
            rows.map((row) => row.prospectId),
          ),
        ),
      )
      .groupBy(letters.prospectId),
  ]);
  const lastVisit = new Map(visitRows.map((row) => [row.exposeId, row.at]));
  const lastLetter = new Map(letterRows.map((row) => [row.prospectId, row.at]));
  for (const row of rows) {
    const lastActivityAt = lastActivity([
      row.publishedAt,
      row.resetAt,
      lastVisit.get(row.id),
      lastLetter.get(row.prospectId),
    ]);
    result.set(row.id, { ...expiryState({ lastActivityAt, settings, now }), lastActivityAt });
  }
  return result;
}

/** Expiry of one exposé; not expired when it does not exist. */
export async function exposeExpiry(
  db: Reader,
  workspaceId: string,
  exposeId: string,
  settings: ExposeExpirySettings,
  now = new Date(),
): Promise<ExposeExpiry> {
  const expiries = await exposeExpiries(db, workspaceId, settings, { exposeIds: [exposeId], now });
  return expiries.get(exposeId) ?? { expired: false, expiresAt: null, lastActivityAt: now };
}
