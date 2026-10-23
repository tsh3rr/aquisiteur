import "server-only";
import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, notExists, or } from "drizzle-orm";
import type { Database } from "@/db";
import {
  auditLog,
  callbackRequests,
  chatMessages,
  chatThreads,
  events,
  intentScores,
  invoices,
  prospects,
  rateLimits,
  sessionReplays,
  sessions,
  verifications,
  visits,
  workspaceSettings,
} from "@/db/schema";
import { replayFolder } from "@/domain/tracking/replay";
import { workspaceSettingsSchema } from "@/domain/workspace-settings";
import { getInfra } from "@/infra";

/**
 * Retention (§9), run by the hourly job on the system connection. Every
 * query names its workspace; the periods come from `workspace_settings`.
 *
 * - Raw events older than `eventsDays` (default 180) are deleted. Visits stay
 *   as the aggregate the dashboards count; they hold no IP address.
 * - A prospect who opted out keeps only the block marker: after
 *   `optOutTrackingDays` (default 30) its visits, events, consents,
 *   recordings and score are deleted. Chats and callback requests stay as
 *   correspondence, unlinked from the deleted visits.
 * - A restricted prospect (Sperrvermerk, ADR-0071) is deleted with its
 *   invoices, projects and offers once its newest issued invoice is past the
 *   retention period of § 132 BAO (seven years from the end of its year).
 * - Expired sign-in rows and stale rate-limit counters are removed.
 */

const DAY = 24 * 3600 * 1000;

export interface RetentionResult {
  eventsDeleted: number;
  prospectsPurged: number;
  restrictedDeleted: number;
  authRowsDeleted: number;
}

export async function runRetention(
  db: Database,
  now = new Date(),
  onlyWorkspaceId?: string,
): Promise<RetentionResult> {
  const rows = await db
    .select({ workspaceId: workspaceSettings.workspaceId, retention: workspaceSettings.retention })
    .from(workspaceSettings)
    .where(onlyWorkspaceId ? eq(workspaceSettings.workspaceId, onlyWorkspaceId) : undefined);
  let eventsDeleted = 0;
  let prospectsPurged = 0;
  let restrictedDeleted = 0;
  for (const row of rows) {
    const retention = workspaceSettingsSchema.shape.retention.parse(row.retention);
    const eventCutoff = new Date(now.getTime() - retention.eventsDays * DAY);
    const deleted = await db
      .delete(events)
      .where(and(eq(events.workspaceId, row.workspaceId), lt(events.createdAt, eventCutoff)))
      .returning({ id: events.id });
    eventsDeleted += deleted.length;

    const optOutCutoff = new Date(now.getTime() - retention.optOutTrackingDays * DAY);
    const due = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(
        and(
          eq(prospects.workspaceId, row.workspaceId),
          isNotNull(prospects.doNotContactAt),
          lt(prospects.doNotContactAt, optOutCutoff),
          isNull(prospects.trackingPurgedAt),
        ),
      );
    for (const prospect of due) {
      await purgeProspectTracking(db, row.workspaceId, prospect.id, now);
      prospectsPurged++;
    }
    restrictedDeleted += await purgeRestrictedProspects(db, row.workspaceId, now);
  }
  const authRowsDeleted = onlyWorkspaceId ? 0 : await purgeAuthLeftovers(db, now);
  return { eventsDeleted, prospectsPurged, restrictedDeleted, authRowsDeleted };
}

/** Deletes a prospect's tracking data and keeps the prospect as a block marker. */
export async function purgeProspectTracking(
  db: Database,
  workspaceId: string,
  prospectId: string,
  now = new Date(),
) {
  const replays = await db
    .select({ id: sessionReplays.id })
    .from(sessionReplays)
    .where(
      and(eq(sessionReplays.workspaceId, workspaceId), eq(sessionReplays.prospectId, prospectId)),
    );
  await deleteReplayFiles(
    workspaceId,
    replays.map((r) => r.id),
  );
  await db.transaction(async (tx) => {
    const visitIds = tx
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.workspaceId, workspaceId), eq(visits.prospectId, prospectId)));
    await tx
      .update(chatThreads)
      .set({ visitId: null })
      .where(and(eq(chatThreads.workspaceId, workspaceId), inArray(chatThreads.visitId, visitIds)));
    await tx
      .update(chatMessages)
      .set({ visitId: null })
      .where(
        and(eq(chatMessages.workspaceId, workspaceId), inArray(chatMessages.visitId, visitIds)),
      );
    await tx
      .update(callbackRequests)
      .set({ visitId: null })
      .where(
        and(
          eq(callbackRequests.workspaceId, workspaceId),
          inArray(callbackRequests.visitId, visitIds),
        ),
      );
    // Events, consents, drafts and recordings go with their visits (on delete cascade).
    await tx
      .delete(visits)
      .where(and(eq(visits.workspaceId, workspaceId), eq(visits.prospectId, prospectId)));
    await tx
      .delete(intentScores)
      .where(
        and(eq(intentScores.workspaceId, workspaceId), eq(intentScores.prospectId, prospectId)),
      );
    await tx
      .update(prospects)
      .set({ trackingPurgedAt: now })
      .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospectId)));
    await tx.insert(auditLog).values({
      workspaceId,
      actorUserId: null,
      action: "prospect.tracking_purged",
      targetType: "prospect",
      targetId: prospectId,
      meta: { recordings: replays.length },
    });
  });
}

/** First day whose invoices are still kept: 1 January seven years back. */
export function invoiceRetentionCutoff(now: Date): string {
  return `${now.getUTCFullYear() - 7}-01-01`;
}

/**
 * Deletes restricted prospects whose issued invoices are all past the
 * retention period; the invoice trigger refuses anything younger.
 */
export async function purgeRestrictedProspects(
  db: Database,
  workspaceId: string,
  now = new Date(),
): Promise<number> {
  const cutoff = invoiceRetentionCutoff(now);
  const kept = db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.workspaceId, workspaceId),
        eq(invoices.prospectId, prospects.id),
        ne(invoices.status, "draft"),
        or(isNull(invoices.issueDate), gte(invoices.issueDate, cutoff)),
      ),
    );
  const due = await db
    .select({ id: prospects.id })
    .from(prospects)
    .where(
      and(
        eq(prospects.workspaceId, workspaceId),
        isNotNull(prospects.restrictedAt),
        notExists(kept),
      ),
    );
  for (const prospect of due) {
    await db.transaction(async (tx) => {
      const removed = await tx
        .delete(invoices)
        .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.prospectId, prospect.id)))
        .returning({ id: invoices.id });
      // Projects, offers and payments go with the prospect and its invoices (on delete cascade).
      await tx
        .delete(prospects)
        .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospect.id)));
      await tx.insert(auditLog).values({
        workspaceId,
        actorUserId: null,
        action: "prospect.retention_deleted",
        targetType: "prospect",
        targetId: prospect.id,
        meta: { invoices: removed.length },
      });
    });
  }
  return due.length;
}

/** Recording chunks live in storage, outside the database's cascades. */
export async function deleteReplayFiles(workspaceId: string, replayIds: string[]) {
  const storage = getInfra().storage;
  for (const id of replayIds) {
    await storage.deletePrefix(replayFolder(workspaceId, id)).catch(() => 0);
  }
}

async function purgeAuthLeftovers(db: Database, now: Date): Promise<number> {
  const limits = await db
    .delete(rateLimits)
    .where(lt(rateLimits.lastRequest, now.getTime() - DAY))
    .returning({ id: rateLimits.id });
  const links = await db
    .delete(verifications)
    .where(lt(verifications.expiresAt, new Date(now.getTime() - DAY)))
    .returning({ id: verifications.id });
  const expired = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return limits.length + links.length + expired.length;
}
