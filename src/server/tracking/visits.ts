import "server-only";
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import type { Database, Transaction } from "@/db";
import { events, exposes, prospects, touchpoints, visits } from "@/db/schema";
import { notificationCopy, notificationUrl } from "@/domain/notifications";
import { activityPhrase } from "@/domain/tracking/activity";
import {
  eventBatchSchema,
  parseEvents,
  visitStartSchema,
  type TrackedEvent,
} from "@/domain/tracking/events";
import {
  isQrTokenShape,
  normalizeShortCode,
  suggestShortCodes,
} from "@/domain/tracking/short-links";
import { signToken, verifyToken } from "@/domain/tracking/signed-token";
import { detectBot, geoFromHeaders, parseUserAgent } from "@/domain/tracking/user-agent";
import { workspaceAvailable } from "@/server/chat/presence";
import { defer } from "@/server/defer";
import { processProspect } from "@/server/intent/process";
import type { NotifyInput } from "@/server/notifications/notify";
import { publish, workspaceTopic } from "@/server/realtime";
import { advanceStatus } from "@/server/prospects/auto-status";
import { hitRateLimit } from "./rate-limit";
import { createTouchpoint } from "./touchpoints";

/**
 * Public tracking flow (§6.2, §6.3). Visitors have no tenant context, so
 * everything here runs on the system connection and scopes every query to
 * the workspace resolved from the host. Nothing identifies a person: no IP,
 * no cookie for prospects; the visit token lives in the page's memory.
 */

export const OWNER_COOKIE = "aq_owner";
const TICKET_TTL = 15 * 60;
const VISIT_TTL = 12 * 60 * 60;
export const OWNER_COOKIE_TTL = 400 * 24 * 60 * 60;
export const OWNER_LINK_TTL = 10 * 60;

function secret(): string {
  return serverEnv().BETTER_AUTH_SECRET;
}

export function signOwnerLink(workspaceId: string): Promise<string> {
  return signToken(secret(), "owner_link", workspaceId, OWNER_LINK_TTL);
}

/** Owner-device cookie value from a cockpit link, or null if the link is invalid. */
export async function ownerCookieFromLink(link: string, workspaceId: string) {
  if ((await verifyToken(secret(), "owner_link", link)) !== workspaceId) return null;
  return signToken(secret(), "owner", workspaceId, OWNER_COOKIE_TTL);
}

export async function isOwnerDevice(cookie: string | undefined, workspaceId: string) {
  if (!cookie) return false;
  return (await verifyToken(secret(), "owner", cookie)) === workspaceId;
}

export interface ResolvedCode {
  touchpointId: string;
  prospectId: string;
  exposeId: string;
  slug: string;
  source: "qr" | "typed" | "share";
}

/**
 * A QR token (exact) or a short code (normalised) of an active touchpoint.
 * `qrOnly` while typed codes are blocked (short-link-guard.ts).
 */
export async function resolveCode(
  db: Database,
  workspaceId: string,
  raw: string,
  options: { qrOnly?: boolean } = {},
): Promise<ResolvedCode | null> {
  const typed = options.qrOnly ? "" : normalizeShortCode(raw);
  const matches = [
    ...(isQrTokenShape(raw) ? [eq(touchpoints.qrToken, raw)] : []),
    ...(typed ? [eq(touchpoints.shortCode, typed)] : []),
  ];
  if (matches.length === 0) return null;
  const rows = await db
    .select({
      touchpointId: touchpoints.id,
      prospectId: touchpoints.prospectId,
      exposeId: touchpoints.exposeId,
      channel: touchpoints.channel,
      qrToken: touchpoints.qrToken,
      slug: exposes.slug,
    })
    .from(touchpoints)
    .innerJoin(
      exposes,
      and(eq(exposes.workspaceId, touchpoints.workspaceId), eq(exposes.id, touchpoints.exposeId)),
    )
    .where(
      and(
        eq(touchpoints.workspaceId, workspaceId),
        isNull(touchpoints.disabledAt),
        isNull(exposes.unpublishedAt),
        isNotNull(exposes.currentVersionId),
        or(...matches),
      ),
    )
    .limit(2);
  const row = rows.find((r) => r.qrToken === raw) ?? rows[0];
  if (!row) return null;
  const byQr = row.qrToken === raw;
  return {
    touchpointId: row.touchpointId,
    prospectId: row.prospectId,
    exposeId: row.exposeId,
    slug: row.slug,
    source: row.channel === "share" ? "share" : byQr ? "qr" : "typed",
  };
}

/** „Meinten Sie …?“ candidates among the workspace's active short codes. */
export async function shortCodeSuggestions(db: Database, workspaceId: string, typed: string) {
  if (normalizeShortCode(typed).length < 3) return [];
  const rows = await db
    .select({ code: touchpoints.shortCode })
    .from(touchpoints)
    .innerJoin(
      exposes,
      and(eq(exposes.workspaceId, touchpoints.workspaceId), eq(exposes.id, touchpoints.exposeId)),
    )
    .where(
      and(
        eq(touchpoints.workspaceId, workspaceId),
        isNull(touchpoints.disabledAt),
        isNull(exposes.unpublishedAt),
        isNotNull(touchpoints.shortCode),
      ),
    );
  return suggestShortCodes(
    typed,
    rows.flatMap((row) => (row.code ? [row.code] : [])),
  );
}

interface VisitInput {
  workspaceId: string;
  prospectId: string;
  exposeId: string;
  touchpointId: string | null;
  source: "qr" | "typed" | "share" | "direct";
  headers: Headers;
  internal: boolean;
  /** Extra bot signal from the caller (HEAD request, empty viewport). */
  botReason?: string | null;
  confirmed?: boolean;
}

export async function createVisit(db: Database | Transaction, input: VisitInput) {
  const device = parseUserAgent(input.headers.get("user-agent"));
  const botReason = input.botReason ?? detectBot(input.headers);
  const geo = geoFromHeaders(input.headers);
  const [row] = await db
    .insert(visits)
    .values({
      workspaceId: input.workspaceId,
      prospectId: input.prospectId,
      exposeId: input.exposeId,
      touchpointId: input.touchpointId,
      source: input.source,
      device: device.device,
      browser: device.browser,
      os: device.os,
      city: geo.city,
      country: geo.country,
      isBot: botReason !== null,
      botReason,
      isInternal: input.internal,
      confirmedAt: input.confirmed ? new Date() : null,
    })
    .returning({ id: visits.id, isBot: visits.isBot });
  return row!;
}

export async function ticketForVisit(visitId: string) {
  return signToken(secret(), "ticket", visitId, TICKET_TTL);
}

export type StartResult =
  | {
      token: string;
      /** An earlier real visit of this prospect exists (for the greeting nudge). */
      returning: boolean;
      /** Someone of the workspace is reachable right now (§7.4). */
      available: boolean;
    }
  | { error: "invalid" | "not_found" | "limited" };

/** Visits of the same prospect that started at least this long before count as a return. */
const RETURN_GAP_MS = 30 * 60 * 1000;

/**
 * The exposé's script reports in (§6.3): a real browser rendered the page.
 * Confirms the resolver's visit when a valid ticket comes along, otherwise
 * starts a direct visit. Returns the token for sending events.
 */
export async function startVisit(
  db: Database,
  input: { workspaceId: string; body: unknown; headers: Headers; internal: boolean },
): Promise<StartResult> {
  const parsed = visitStartSchema.safeParse(input.body);
  if (!parsed.success) return { error: "invalid" };
  const { slug, ticket, viewport } = parsed.data;

  const [expose] = await db
    .select({ id: exposes.id, prospectId: exposes.prospectId })
    .from(exposes)
    .where(
      and(
        eq(exposes.workspaceId, input.workspaceId),
        eq(exposes.slug, slug),
        isNull(exposes.unpublishedAt),
      ),
    );
  if (!expose) return { error: "not_found" };
  if (!(await hitRateLimit(db, `t:start:${expose.id}`, 60, 600))) return { error: "limited" };

  const botReason =
    detectBot(input.headers) ??
    (viewport && (viewport.width === 0 || viewport.height === 0)
      ? "Kein sichtbares Fenster"
      : null);

  const started = await db.transaction(async (tx) => {
    /** `quiet`: bot or owner; such visits never change the status. */
    let visit: { id: string; quiet: boolean } | undefined;
    const ticketVisitId = ticket ? await verifyToken(secret(), "ticket", ticket) : null;
    if (ticketVisitId && /^[0-9a-f-]{36}$/.test(ticketVisitId)) {
      [visit] = await tx
        .update(visits)
        .set({
          confirmedAt: new Date(),
          lastSeenAt: new Date(),
          isInternal: sql`${visits.isInternal} or ${input.internal}`,
          isBot: sql`${visits.isBot} or ${botReason !== null}`,
          botReason: sql`coalesce(${visits.botReason}, ${botReason})`,
        })
        .where(
          and(
            eq(visits.workspaceId, input.workspaceId),
            eq(visits.id, ticketVisitId),
            eq(visits.exposeId, expose.id),
            isNull(visits.confirmedAt),
            gt(visits.startedAt, new Date(Date.now() - TICKET_TTL * 1000)),
          ),
        )
        .returning({ id: visits.id, isBot: visits.isBot, isInternal: visits.isInternal })
        .then((rows) => rows.map((r) => ({ id: r.id, quiet: r.isBot || r.isInternal })));
    }
    const current: { id: string; quiet: boolean } =
      visit ??
      (await createVisit(tx, {
        workspaceId: input.workspaceId,
        prospectId: expose.prospectId,
        exposeId: expose.id,
        touchpointId: null,
        source: "direct",
        headers: input.headers,
        internal: input.internal,
        botReason,
        confirmed: true,
      }).then((row) => ({ id: row.id, quiet: row.isBot || input.internal })));

    await tx.insert(events).values({
      workspaceId: input.workspaceId,
      visitId: current.id,
      exposeId: expose.id,
      type: "page_view",
      occurredAt: new Date(),
    });
    await tx
      .update(visits)
      .set({ eventCount: sql`${visits.eventCount} + 1` })
      .where(and(eq(visits.workspaceId, input.workspaceId), eq(visits.id, current.id)));
    if (!current.quiet) {
      await advanceStatus(tx, {
        workspaceId: input.workspaceId,
        prospectId: expose.prospectId,
        to: "opened",
        via: "visit",
        meta: { visitId: current.id },
      });
    }
    const [earlier] = await tx
      .select({ id: visits.id })
      .from(visits)
      .where(
        and(
          eq(visits.workspaceId, input.workspaceId),
          eq(visits.prospectId, expose.prospectId),
          isNotNull(visits.confirmedAt),
          eq(visits.isBot, false),
          eq(visits.isInternal, false),
          lt(visits.startedAt, new Date(Date.now() - RETURN_GAP_MS)),
        ),
      )
      .limit(1);
    const [{ count } = { count: 0 }] = current.quiet
      ? []
      : await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(visits)
          .where(
            and(
              eq(visits.workspaceId, input.workspaceId),
              eq(visits.prospectId, expose.prospectId),
              isNotNull(visits.confirmedAt),
              eq(visits.isBot, false),
              eq(visits.isInternal, false),
            ),
          );
    return {
      result: {
        token: await signToken(secret(), "visit", current.id, VISIT_TTL),
        returning: Boolean(earlier),
        available: await workspaceAvailable(db, input.workspaceId),
      },
      visitId: current.id,
      quiet: current.quiet,
      trigger: count === 1 ? ("first_visit" as const) : earlier ? ("return_visit" as const) : null,
    };
  });

  if (!started.quiet) {
    await defer(async () => {
      await publishActivity(db, input.workspaceId, expose.prospectId, {
        type: "page_view",
        occurredAt: new Date(),
      });
      await visitSignal(db, {
        workspaceId: input.workspaceId,
        prospectId: expose.prospectId,
        visitId: started.visitId,
        trigger: started.trigger,
      });
    });
  }
  return started.result;
}

/** Score and the „opened“ / „reading again“ notification for a real visit (§7.7). */
async function visitSignal(
  db: Database,
  input: {
    workspaceId: string;
    prospectId: string;
    visitId: string;
    trigger: "first_visit" | "return_visit" | null;
  },
) {
  let cause: NotifyInput | null = null;
  if (input.trigger) {
    const [visit] = await db
      .select({
        source: visits.source,
        device: visits.device,
        city: visits.city,
        company: prospects.companyName,
      })
      .from(visits)
      .innerJoin(
        prospects,
        and(eq(prospects.workspaceId, visits.workspaceId), eq(prospects.id, visits.prospectId)),
      )
      .where(and(eq(visits.workspaceId, input.workspaceId), eq(visits.id, input.visitId)));
    if (visit) {
      cause = {
        workspaceId: input.workspaceId,
        trigger: input.trigger,
        prospectId: input.prospectId,
        groupKey:
          input.trigger === "first_visit"
            ? `first_visit:${input.prospectId}`
            : `return_visit:${input.visitId}`,
        url: notificationUrl({ trigger: input.trigger, prospectId: input.prospectId }),
        ...notificationCopy({ trigger: input.trigger, company: visit.company, visit }),
      };
    }
  }
  await processProspect(db, {
    workspaceId: input.workspaceId,
    prospectId: input.prospectId,
    cause,
  });
}

/** The visit behind an exposé's visit token, scoped to the host's workspace. */
export async function visitForToken(db: Database, workspaceId: string, token: string) {
  const visitId = await verifyToken(secret(), "visit", token);
  if (!visitId || !/^[0-9a-f-]{36}$/.test(visitId)) return null;
  const [visit] = await db
    .select({
      id: visits.id,
      exposeId: visits.exposeId,
      prospectId: visits.prospectId,
      startedAt: visits.startedAt,
      confirmedAt: visits.confirmedAt,
      quiet: sql<boolean>`${visits.isBot} or ${visits.isInternal}`,
    })
    .from(visits)
    .where(and(eq(visits.workspaceId, workspaceId), eq(visits.id, visitId)));
  return visit ?? null;
}

function payloadOf(event: TrackedEvent): Record<string, unknown> {
  const { type: _type, at: _at, ...rest } = event;
  if ("blockId" in rest) delete (rest as { blockId?: string }).blockId;
  return rest;
}

export type IngestResult = "ok" | "invalid" | "limited";

/** A batch of events from the exposé's script (§6.3). */
export async function ingestEvents(
  db: Database,
  input: { workspaceId: string; body: unknown },
): Promise<IngestResult> {
  const batch = eventBatchSchema.safeParse(input.body);
  if (!batch.success) return "invalid";
  const visit = await visitForToken(db, input.workspaceId, batch.data.token);
  if (!visit) return "invalid";
  if (!(await hitRateLimit(db, `t:e:${visit.id}`, 120, 600))) return "limited";
  const parsed = parseEvents(batch.data.events);
  if (parsed.length === 0) return "ok";

  const origin = (visit.confirmedAt ?? visit.startedAt).getTime();
  const now = Date.now();
  let seconds = 0;
  let scroll = 0;
  const rows = parsed.map((event) => {
    if (event.type === "heartbeat") seconds += event.seconds;
    if (event.type === "scroll_depth") scroll = Math.max(scroll, event.percent);
    return {
      workspaceId: input.workspaceId,
      visitId: visit.id,
      exposeId: visit.exposeId,
      type: event.type,
      blockId: "blockId" in event ? (event.blockId ?? null) : null,
      payload: payloadOf(event),
      occurredAt: new Date(Math.min(origin + event.at, now)),
    };
  });
  // Heartbeats only feed the visit's active time; the timeline does not need each one.
  const stored = rows.filter((row) => row.type !== "heartbeat");
  await db.transaction(async (tx) => {
    if (stored.length > 0) await tx.insert(events).values(stored);
    await tx
      .update(visits)
      .set({
        lastSeenAt: new Date(),
        activeSeconds: sql`${visits.activeSeconds} + ${seconds}`,
        maxScroll: sql`greatest(${visits.maxScroll}, ${scroll})`,
        eventCount: sql`${visits.eventCount} + ${stored.length}`,
      })
      .where(and(eq(visits.workspaceId, input.workspaceId), eq(visits.id, visit.id)));
  });
  if (!visit.quiet) {
    const latest = [...stored].reverse().find((row) => activityPhrase(row));
    await defer(async () => {
      if (latest) await publishActivity(db, input.workspaceId, visit.prospectId, latest);
      await processProspect(db, { workspaceId: input.workspaceId, prospectId: visit.prospectId });
    });
  }
  return "ok";
}

/** „Jetzt gerade: Café Müller ist gerade im Exposé“ for the live feed on „Heute“ (ADR-0064). */
async function publishActivity(
  db: Database,
  workspaceId: string,
  prospectId: string,
  event: { type: string; occurredAt: Date },
) {
  const [prospect] = await db
    .select({ company: prospects.companyName })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospectId)));
  const phrase = activityPhrase(event);
  if (!prospect || !phrase) return;
  await publish([workspaceTopic(workspaceId)], "visit.activity", {
    prospectId,
    company: prospect.company,
    text: phrase,
    at: event.occurredAt.toISOString(),
  });
}

/**
 * „Mit Kollegen teilen“ (§7.3): a fresh share touchpoint per visit, so a
 * forwarded reader shows up as such. Reuses the visit's last one.
 */
export async function shareLinkForVisit(
  db: Database,
  input: { workspaceId: string; token: unknown },
): Promise<{ qrToken: string } | "invalid" | "limited"> {
  if (typeof input.token !== "string" || input.token.length > 200) return "invalid";
  const visit = await visitForToken(db, input.workspaceId, input.token);
  if (!visit) return "invalid";
  const [existing] = await db
    .select({ qrToken: touchpoints.qrToken })
    .from(touchpoints)
    .where(
      and(
        eq(touchpoints.workspaceId, input.workspaceId),
        eq(touchpoints.parentVisitId, visit.id),
        isNull(touchpoints.disabledAt),
      ),
    )
    .limit(1);
  if (existing) return existing;
  if (!(await hitRateLimit(db, `t:share:${visit.exposeId}`, 30, 3600))) return "limited";
  const created = await createTouchpoint(db, {
    workspaceId: input.workspaceId,
    prospectId: visit.prospectId,
    exposeId: visit.exposeId,
    channel: "share",
    label: "Weitergeleitet",
    shortCode: null,
    parentVisitId: visit.id,
  });
  return { qrToken: created!.qrToken };
}
