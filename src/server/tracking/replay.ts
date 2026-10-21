import "server-only";
import { and, desc, eq, lt, notInArray, sql } from "drizzle-orm";
import type { Database, Transaction } from "@/db";
import {
  chatDrafts,
  consents,
  events,
  sessionReplays,
  visits,
  workspaceSettings,
} from "@/db/schema";
import { BASIS_EVENT_TYPES, type ConsentPurpose } from "@/domain/tracking/consent";
import { SERVER_EVENT_TYPES } from "@/domain/tracking/events";
import { workspaceSettingsSchema } from "@/domain/workspace-settings";
import {
  consentBodySchema,
  REPLAY_LIMITS,
  replayChunkKey,
  replayChunkSchema,
  type ReplayEvent,
} from "@/domain/tracking/replay";
import { getInfra } from "@/infra";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { hitRateLimit } from "./rate-limit";
import { visitForToken } from "./visits";

/**
 * Consent and session replay (§6.3, §9). Public routes run on the system
 * connection and scope every query to the host's workspace; the cockpit
 * reads replays as tenant.
 */

export type ConsentResult = "ok" | "invalid" | "limited" | "disabled";

/**
 * Stores a visitor's answer for one purpose as proof (notice version, time,
 * visit). Withdrawing removes what the purpose produced in this visit: the
 * recording, or the reading statistics (ADR-0065).
 */
export async function recordConsent(
  db: Database,
  input: { workspaceId: string; body: unknown },
): Promise<ConsentResult> {
  const parsed = consentBodySchema.safeParse(input.body);
  if (!parsed.success) return "invalid";
  const visit = await visitForToken(db, input.workspaceId, parsed.data.token);
  if (!visit) return "invalid";
  if (!(await hitRateLimit(db, `t:consent:${visit.id}`, 10, 600))) return "limited";
  const { scope, decision, version } = parsed.data;
  // Withdrawing always works, even after the owner switched replay off.
  if (scope === "replay" && decision !== "withdrawn") {
    const settings = await loadWorkspaceSettings(db, input.workspaceId);
    if (!settings.replay.enabled) return "disabled";
  }
  await db.transaction(async (tx) => {
    await tx.insert(consents).values({
      workspaceId: input.workspaceId,
      prospectId: visit.prospectId,
      visitId: visit.id,
      scope,
      decision,
      noticeVersion: version,
    });
    await tx.insert(events).values({
      workspaceId: input.workspaceId,
      visitId: visit.id,
      exposeId: visit.exposeId,
      type: `consent_${decision}`,
      payload: { version, scope },
      occurredAt: new Date(),
    });
    if (scope === "statistics" && decision === "withdrawn") {
      await purgeStatisticsOfVisit(tx, input.workspaceId, visit.id);
    }
  });
  if (scope === "replay" && decision === "withdrawn") {
    await deleteReplayOfVisit(db, input.workspaceId, visit.id);
  }
  return "ok";
}

/** Everything the script observed beyond the basis, for one visit. */
async function purgeStatisticsOfVisit(tx: Transaction, workspaceId: string, visitId: string) {
  const kept = [...BASIS_EVENT_TYPES, ...SERVER_EVENT_TYPES];
  const removed = await tx
    .delete(events)
    .where(
      and(
        eq(events.workspaceId, workspaceId),
        eq(events.visitId, visitId),
        notInArray(events.type, kept),
      ),
    )
    .returning({ id: events.id });
  await tx
    .update(visits)
    .set({
      activeSeconds: 0,
      maxScroll: 0,
      eventCount: sql`greatest(${visits.eventCount} - ${removed.length}, 0)`,
    })
    .where(and(eq(visits.workspaceId, workspaceId), eq(visits.id, visitId)));
  await tx
    .delete(chatDrafts)
    .where(and(eq(chatDrafts.workspaceId, workspaceId), eq(chatDrafts.visitId, visitId)));
}

async function latestDecision(
  db: Database,
  workspaceId: string,
  visitId: string,
  scope: ConsentPurpose,
) {
  const [row] = await db
    .select({ decision: consents.decision })
    .from(consents)
    .where(
      and(
        eq(consents.workspaceId, workspaceId),
        eq(consents.visitId, visitId),
        eq(consents.scope, scope),
      ),
    )
    .orderBy(desc(consents.createdAt))
    .limit(1);
  return row?.decision ?? null;
}

export type ChunkResult = "ok" | "invalid" | "limited" | "forbidden" | "full";

/**
 * One upload of rrweb events. Only after a „given“ for this very visit;
 * stored gzip-compressed, numbered by the server, capped per visit.
 */
export async function appendReplayChunk(
  db: Database,
  input: { workspaceId: string; body: unknown; rawBytes: number },
): Promise<ChunkResult> {
  const parsed = replayChunkSchema.safeParse(input.body);
  if (!parsed.success || input.rawBytes > REPLAY_LIMITS.chunkBytes) return "invalid";
  const visit = await visitForToken(db, input.workspaceId, parsed.data.token);
  if (!visit) return "invalid";
  if (!(await hitRateLimit(db, `t:replay:${visit.id}`, 60, 600))) return "limited";
  if ((await latestDecision(db, input.workspaceId, visit.id, "replay")) !== "given") {
    return "forbidden";
  }
  const [bot] = await db
    .select({ isBot: visits.isBot })
    .from(visits)
    .where(and(eq(visits.workspaceId, input.workspaceId), eq(visits.id, visit.id)));
  if (bot?.isBot) return "forbidden";

  const body = await gzip(JSON.stringify(parsed.data.events));
  const stamps = parsed.data.events.map((event) => Math.round(event.timestamp));
  const firstEvent = Math.min(...stamps);
  const lastEvent = Math.max(...stamps);
  await db
    .insert(sessionReplays)
    .values({
      workspaceId: input.workspaceId,
      prospectId: visit.prospectId,
      visitId: visit.id,
      // Recording start as the browser saw it; duration is measured from here.
      startedAt: new Date(firstEvent),
    })
    .onConflictDoNothing();
  // Claim the next chunk number atomically, within the caps.
  const [claimed] = await db
    .update(sessionReplays)
    .set({
      chunkCount: sql`${sessionReplays.chunkCount} + 1`,
      bytes: sql`${sessionReplays.bytes} + ${body.byteLength}`,
      durationMs: sql`greatest(${sessionReplays.durationMs}, (${lastEvent}::bigint - extract(epoch from ${sessionReplays.startedAt}) * 1000)::int)`,
      lastChunkAt: new Date(),
    })
    .where(
      and(
        eq(sessionReplays.workspaceId, input.workspaceId),
        eq(sessionReplays.visitId, visit.id),
        sql`${sessionReplays.chunkCount} < ${REPLAY_LIMITS.chunks}`,
        sql`${sessionReplays.bytes} + ${body.byteLength} <= ${REPLAY_LIMITS.totalBytes}`,
      ),
    )
    .returning({ id: sessionReplays.id, chunkCount: sessionReplays.chunkCount });
  if (!claimed) return "full";
  await getInfra().storage.put(
    replayChunkKey(input.workspaceId, claimed.id, claimed.chunkCount - 1),
    body,
    { contentType: "application/gzip" },
  );
  return "ok";
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(body: ReadableStream): Promise<string> {
  return new Response(body.pipeThrough(new DecompressionStream("gzip"))).text();
}

async function deleteChunks(workspaceId: string, replayId: string, count: number) {
  const storage = getInfra().storage;
  for (let n = 0; n < count; n++) {
    await storage.delete(replayChunkKey(workspaceId, replayId, n)).catch(() => undefined);
  }
}

/** Withdrawal: the recording of this visit is gone at once. */
async function deleteReplayOfVisit(db: Database, workspaceId: string, visitId: string) {
  const deleted = await db
    .delete(sessionReplays)
    .where(and(eq(sessionReplays.workspaceId, workspaceId), eq(sessionReplays.visitId, visitId)))
    .returning({ id: sessionReplays.id, chunkCount: sessionReplays.chunkCount });
  for (const row of deleted) await deleteChunks(workspaceId, row.id, row.chunkCount);
}

export interface ReplaySummary {
  id: string;
  visitId: string;
  durationMs: number;
  bytes: number;
  startedAt: Date;
}

/** Replays of one prospect, for the visit list in the cockpit. */
export async function listReplays(
  tx: Transaction,
  workspaceId: string,
  prospectId: string,
): Promise<ReplaySummary[]> {
  return tx
    .select({
      id: sessionReplays.id,
      visitId: sessionReplays.visitId,
      durationMs: sessionReplays.durationMs,
      bytes: sessionReplays.bytes,
      startedAt: sessionReplays.startedAt,
    })
    .from(sessionReplays)
    .where(
      and(eq(sessionReplays.workspaceId, workspaceId), eq(sessionReplays.prospectId, prospectId)),
    )
    .orderBy(desc(sessionReplays.startedAt));
}

/** All events of a replay, in order; missing chunks are skipped. */
export async function loadReplayEvents(
  tx: Transaction,
  workspaceId: string,
  replayId: string,
): Promise<{ prospectId: string; events: ReplayEvent[] } | null> {
  const [row] = await tx
    .select({ prospectId: sessionReplays.prospectId, chunkCount: sessionReplays.chunkCount })
    .from(sessionReplays)
    .where(and(eq(sessionReplays.workspaceId, workspaceId), eq(sessionReplays.id, replayId)));
  if (!row) return null;
  const storage = getInfra().storage;
  const all: ReplayEvent[] = [];
  for (let n = 0; n < row.chunkCount; n++) {
    const file = await storage.get(replayChunkKey(workspaceId, replayId, n));
    if (!file) continue;
    all.push(...(JSON.parse(await gunzip(file.body)) as ReplayEvent[]));
  }
  all.sort((a, b) => a.timestamp - b.timestamp);
  return { prospectId: row.prospectId, events: all };
}

/** The owner deletes one recording from the cockpit. */
export async function deleteReplay(tx: Transaction, workspaceId: string, replayId: string) {
  const deleted = await tx
    .delete(sessionReplays)
    .where(and(eq(sessionReplays.workspaceId, workspaceId), eq(sessionReplays.id, replayId)))
    .returning({ chunkCount: sessionReplays.chunkCount });
  if (deleted[0]) await deleteChunks(workspaceId, replayId, deleted[0].chunkCount);
  return deleted.length > 0;
}

/**
 * Retention (§9): recordings older than the workspace's `replaysDays`
 * (default 90) are deleted with their chunks. Hourly job, system connection.
 */
export async function purgeExpiredReplays(
  db: Database,
  now = new Date(),
  onlyWorkspaceId?: string,
): Promise<number> {
  const rows = await db
    .select({ workspaceId: workspaceSettings.workspaceId, retention: workspaceSettings.retention })
    .from(workspaceSettings)
    .where(onlyWorkspaceId ? eq(workspaceSettings.workspaceId, onlyWorkspaceId) : undefined);
  let purged = 0;
  for (const row of rows) {
    const days = workspaceSettingsSchema.shape.retention.parse(row.retention).replaysDays;
    const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
    const expired = await db
      .delete(sessionReplays)
      .where(
        and(eq(sessionReplays.workspaceId, row.workspaceId), lt(sessionReplays.startedAt, cutoff)),
      )
      .returning({ id: sessionReplays.id, chunkCount: sessionReplays.chunkCount });
    for (const replay of expired) await deleteChunks(row.workspaceId, replay.id, replay.chunkCount);
    purged += expired.length;
  }
  return purged;
}
