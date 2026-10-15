import "server-only";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import {
  auditLog,
  contacts,
  events,
  exposes,
  exposeVersions,
  prospects,
  touchpoints,
  users,
  visits,
} from "@/db/schema";
import type { ExposeDocument } from "@/domain/expose/schema";
import { exposeOutline } from "@/domain/expose/outline";
import { buildTimeline, type TimelineAudit, type TimelineVisit } from "@/domain/tracking/timeline";
import { realVisit } from "./list";

const VISIT_LIMIT = 200;
const EVENT_LIMIT = 3000;

/** Everything the customer detail page shows (§7.8 „360°-Ansicht“). Runs as tenant. */
export async function loadProspectDetail(
  tx: Transaction,
  workspaceId: string,
  prospectId: string,
  options: { showBots: boolean },
) {
  const [prospect] = await tx
    .select()
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospectId)));
  if (!prospect) return null;

  const [people, [expose]] = await Promise.all([
    tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.prospectId, prospectId)))
      .orderBy(desc(contacts.isPrimary), asc(contacts.createdAt)),
    tx
      .select({
        id: exposes.id,
        slug: exposes.slug,
        title: exposes.title,
        refCode: exposes.refCode,
        unpublishedAt: exposes.unpublishedAt,
        version: exposeVersions.version,
        document: exposeVersions.document,
      })
      .from(exposes)
      .leftJoin(exposeVersions, eq(exposeVersions.id, exposes.currentVersionId))
      .where(and(eq(exposes.workspaceId, workspaceId), eq(exposes.prospectId, prospectId))),
  ]);

  const visitCounts = tx
    .select({ touchpointId: visits.touchpointId, visits: count().as("visits") })
    .from(visits)
    .where(and(eq(visits.workspaceId, workspaceId), eq(visits.prospectId, prospectId), realVisit()))
    .groupBy(visits.touchpointId)
    .as("visit_counts");
  const links = await tx
    .select({
      id: touchpoints.id,
      channel: touchpoints.channel,
      label: touchpoints.label,
      qrToken: touchpoints.qrToken,
      shortCode: touchpoints.shortCode,
      disabledAt: touchpoints.disabledAt,
      createdAt: touchpoints.createdAt,
      visits: visitCounts.visits,
    })
    .from(touchpoints)
    .leftJoin(visitCounts, eq(visitCounts.touchpointId, touchpoints.id))
    .where(and(eq(touchpoints.workspaceId, workspaceId), eq(touchpoints.prospectId, prospectId)))
    .orderBy(asc(touchpoints.createdAt));

  const visitRows = await tx
    .select({
      id: visits.id,
      source: visits.source,
      device: visits.device,
      browser: visits.browser,
      os: visits.os,
      city: visits.city,
      isBot: visits.isBot,
      botReason: visits.botReason,
      isInternal: visits.isInternal,
      confirmedAt: visits.confirmedAt,
      startedAt: visits.startedAt,
      lastSeenAt: visits.lastSeenAt,
      activeSeconds: visits.activeSeconds,
      maxScroll: visits.maxScroll,
      touchpointLabel: touchpoints.label,
    })
    .from(visits)
    .leftJoin(
      touchpoints,
      and(eq(touchpoints.workspaceId, visits.workspaceId), eq(touchpoints.id, visits.touchpointId)),
    )
    .where(and(eq(visits.workspaceId, workspaceId), eq(visits.prospectId, prospectId)))
    .orderBy(desc(visits.startedAt))
    .limit(VISIT_LIMIT);

  const visitIds = visitRows.map((visit) => visit.id);
  const eventRows =
    visitIds.length === 0
      ? []
      : await tx
          .select({
            visitId: events.visitId,
            type: events.type,
            blockId: events.blockId,
            payload: events.payload,
            occurredAt: events.occurredAt,
          })
          .from(events)
          .where(and(eq(events.workspaceId, workspaceId), inArray(events.visitId, visitIds)))
          .orderBy(asc(events.occurredAt))
          .limit(EVENT_LIMIT);

  const auditRows = await tx
    .select({
      action: auditLog.action,
      meta: auditLog.meta,
      createdAt: auditLog.createdAt,
      actorName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(
      and(
        eq(auditLog.workspaceId, workspaceId),
        or(
          and(eq(auditLog.targetType, "prospect"), eq(auditLog.targetId, prospectId)),
          expose
            ? and(eq(auditLog.targetType, "expose"), eq(auditLog.targetId, expose.id))
            : sql`false`,
        ),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  const document = (expose?.document as ExposeDocument | undefined) ?? null;
  const outline = exposeOutline(document);
  const timelineVisits: TimelineVisit[] = visitRows;
  const timeline = buildTimeline({
    visits: timelineVisits,
    events: eventRows,
    audits: auditRows.map((row): TimelineAudit => ({
      ...row,
      meta: (row.meta ?? {}) as Record<string, unknown>,
    })),
    outline,
    showBots: options.showBots,
  });

  // Sections read per visit, for the visits table.
  const readSections = new Map<string, string[]>();
  for (const event of eventRows) {
    if (event.type !== "section_dwell" || !event.blockId) continue;
    const list = readSections.get(event.visitId) ?? [];
    const name = outline.blocks.get(event.blockId) ?? event.blockId;
    if (!list.includes(name)) list.push(name);
    readSections.set(event.visitId, list);
  }

  return {
    prospect,
    contacts: people,
    expose: expose
      ? {
          id: expose.id,
          slug: expose.slug,
          title: expose.title,
          refCode: expose.refCode,
          online: !expose.unpublishedAt,
          version: expose.version,
        }
      : null,
    touchpoints: links.map((link) => ({ ...link, visits: Number(link.visits ?? 0) })),
    visits: visitRows.map((visit) => ({
      ...visit,
      sections: readSections.get(visit.id) ?? [],
    })),
    botCount: visitRows.filter((visit) => visit.isBot).length,
    timeline,
  };
}

export type ProspectDetail = NonNullable<Awaited<ReturnType<typeof loadProspectDetail>>>;
