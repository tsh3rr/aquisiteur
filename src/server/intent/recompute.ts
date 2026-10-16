import "server-only";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Database, Transaction } from "@/db";
import {
  callbackRequests,
  chatDrafts,
  chatMessages,
  chatThreads,
  contacts,
  events,
  exposes,
  intentScores,
  prospects,
  visits,
} from "@/db/schema";
import {
  computeIntent,
  type ContactInfo,
  type IntentFacts,
  type IntentResult,
} from "@/domain/intent";
import { storeSignals } from "@/domain/intent/stored";
import { loadWorkspaceSettings } from "@/server/workspaces";

/** Event types that carry a signal (§7.6); everything else is reading detail. */
const SIGNAL_EVENTS = [
  "section_dwell",
  "cta_hover",
  "pricing_change",
  "chat_open",
  "callback_started",
  "copy_contact",
  "contact_click",
];

/** A real visit: the page rendered, no bot, not the owner. */
const realVisit = and(
  isNotNull(visits.confirmedAt),
  eq(visits.isBot, false),
  eq(visits.isInternal, false),
);

/** Messages and callbacks count unless they came from a bot or the owner's own device. */
const notQuiet = or(
  sql`${visits.id} is null`,
  and(eq(visits.isBot, false), eq(visits.isInternal, false)),
);

export interface IntentInput {
  facts: IntentFacts;
  info: ContactInfo;
  company: string;
}

/** Everything the score of one prospect depends on, scoped to its workspace. */
export async function loadIntentInput(
  db: Database | Transaction,
  workspaceId: string,
  prospectId: string,
): Promise<IntentInput | null> {
  const [prospect] = await db
    .select({ company: prospects.companyName, phone: prospects.phone, email: prospects.email })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospectId)));
  if (!prospect) return null;

  const [
    contactRows,
    visitRows,
    eventRows,
    draftRows,
    messageRows,
    callbackRows,
    threadRows,
    exposeRows,
  ] = await Promise.all([
    db
      .select({
        salutation: contacts.salutation,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        phone: contacts.phone,
        email: contacts.email,
      })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.prospectId, prospectId)))
      .orderBy(desc(contacts.isPrimary))
      .limit(1),
    db
      .select({
        id: visits.id,
        startedAt: visits.startedAt,
        activeSeconds: visits.activeSeconds,
        maxScroll: visits.maxScroll,
        device: visits.device,
        source: visits.source,
      })
      .from(visits)
      .where(
        and(eq(visits.workspaceId, workspaceId), eq(visits.prospectId, prospectId), realVisit),
      ),
    db
      .select({
        visitId: events.visitId,
        type: events.type,
        occurredAt: events.occurredAt,
        payload: events.payload,
      })
      .from(events)
      .innerJoin(
        visits,
        and(eq(visits.workspaceId, events.workspaceId), eq(visits.id, events.visitId)),
      )
      .where(
        and(
          eq(events.workspaceId, workspaceId),
          eq(visits.prospectId, prospectId),
          realVisit,
          inArray(events.type, SIGNAL_EVENTS),
        ),
      ),
    db
      .select({
        visitId: chatDrafts.visitId,
        maxLength: chatDrafts.maxLength,
        updatedAt: chatDrafts.updatedAt,
      })
      .from(chatDrafts)
      .innerJoin(
        visits,
        and(eq(visits.workspaceId, chatDrafts.workspaceId), eq(visits.id, chatDrafts.visitId)),
      )
      .where(
        and(
          eq(chatDrafts.workspaceId, workspaceId),
          eq(chatDrafts.prospectId, prospectId),
          realVisit,
        ),
      ),
    db
      .select({ visitId: chatMessages.visitId, createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .innerJoin(
        chatThreads,
        and(
          eq(chatThreads.workspaceId, chatMessages.workspaceId),
          eq(chatThreads.id, chatMessages.threadId),
        ),
      )
      .leftJoin(
        visits,
        and(eq(visits.workspaceId, chatMessages.workspaceId), eq(visits.id, chatMessages.visitId)),
      )
      .where(
        and(
          eq(chatMessages.workspaceId, workspaceId),
          eq(chatThreads.prospectId, prospectId),
          eq(chatMessages.author, "visitor"),
          notQuiet,
        ),
      ),
    db
      .select({
        visitId: callbackRequests.visitId,
        createdAt: callbackRequests.createdAt,
        name: callbackRequests.name,
        phone: callbackRequests.phone,
        preferredTime: callbackRequests.preferredTime,
      })
      .from(callbackRequests)
      .leftJoin(
        visits,
        and(
          eq(visits.workspaceId, callbackRequests.workspaceId),
          eq(visits.id, callbackRequests.visitId),
        ),
      )
      .where(
        and(
          eq(callbackRequests.workspaceId, workspaceId),
          eq(callbackRequests.prospectId, prospectId),
          notQuiet,
        ),
      )
      .orderBy(desc(callbackRequests.createdAt)),
    db
      .select({
        id: chatThreads.id,
        name: chatThreads.visitorName,
        phone: chatThreads.visitorPhone,
        email: chatThreads.visitorEmail,
        hasVisitorMessage: isNotNull(chatThreads.lastVisitorMessageAt),
      })
      .from(chatThreads)
      .where(and(eq(chatThreads.workspaceId, workspaceId), eq(chatThreads.prospectId, prospectId)))
      .orderBy(desc(chatThreads.lastMessageAt))
      .limit(1),
    db
      .select({ refCode: exposes.refCode })
      .from(exposes)
      .where(and(eq(exposes.workspaceId, workspaceId), eq(exposes.prospectId, prospectId)))
      .limit(1),
  ]);

  const contact = contactRows[0];
  const thread = threadRows[0];
  const callback = callbackRows[0];
  const unique = (values: (string | null | undefined)[]) => [
    ...new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  ];
  const fallbackName = callback?.name ?? thread?.name ?? null;

  return {
    company: prospect.company,
    facts: {
      visits: visitRows.map((visit) => ({ ...visit, forwarded: visit.source === "share" })),
      events: eventRows,
      drafts: draftRows,
      messages: messageRows,
      callbacks: callbackRows,
    },
    info: {
      company: prospect.company,
      person:
        contact && (contact.lastName || contact.firstName)
          ? {
              salutation: contact.salutation,
              firstName: contact.firstName,
              lastName: contact.lastName,
            }
          : fallbackName
            ? { salutation: null, firstName: fallbackName, lastName: null }
            : null,
      phones: unique([callback?.phone, thread?.phone, contact?.phone, prospect.phone]),
      emails: unique([thread?.email, contact?.email, prospect.email]),
      refCode: exposeRows[0]?.refCode ?? null,
      preferredTime: callback?.preferredTime ?? null,
      chatThreadId: thread?.hasVisitorMessage ? thread.id : null,
    },
  };
}

export interface Recomputed {
  before: number;
  result: IntentResult;
  company: string;
}

/** Recomputes and stores the score of one prospect (§7.6). */
export async function recomputeIntent(
  db: Database | Transaction,
  workspaceId: string,
  prospectId: string,
  now = new Date(),
): Promise<Recomputed | null> {
  const input = await loadIntentInput(db, workspaceId, prospectId);
  if (!input) return null;
  const settings = await loadWorkspaceSettings(db, workspaceId);
  const result = computeIntent({
    facts: input.facts,
    weights: settings.scoreWeights,
    info: input.info,
    now,
    timeZone: settings.notifications.timezone,
  });
  const [previous] = await db
    .select({ score: intentScores.score })
    .from(intentScores)
    .where(and(eq(intentScores.workspaceId, workspaceId), eq(intentScores.prospectId, prospectId)));
  const values = {
    score: result.score,
    level: result.level,
    signals: storeSignals(result.signals),
    explanation: result.explanation,
    lastSignalAt: result.lastSignalAt,
    computedAt: now,
  };
  await db
    .insert(intentScores)
    .values({ workspaceId, prospectId, ...values })
    .onConflictDoUpdate({
      target: [intentScores.workspaceId, intentScores.prospectId],
      set: values,
    });
  return { before: previous?.score ?? 0, result, company: input.company };
}
