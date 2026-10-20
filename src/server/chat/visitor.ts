import "server-only";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import type { Database, Transaction } from "@/db";
import {
  callbackRequests,
  chatDrafts,
  chatMessages,
  chatThreads,
  events,
  exposes,
  prospects,
  visits,
} from "@/db/schema";
import {
  callbackRequestSchema,
  chatReadSchema,
  issuesByField,
  offlineNoticeDue,
  offlineNoticeText,
  returnChannelSchema,
  visitorMessageSchema,
  visitorTypingSchema,
} from "@/domain/chat";
import { contactLinks } from "@/domain/expose/contact-links";
import { LONG_DRAFT, SHORT_DRAFT } from "@/domain/intent/score";
import { notificationCopy, notificationUrl } from "@/domain/notifications";
import type { ChatMessageView } from "@/domain/realtime";
import { signToken, verifyToken } from "@/domain/tracking/signed-token";
import type { RealtimeSubscription } from "@/infra";
import { defer } from "@/server/defer";
import { processProspect } from "@/server/intent/process";
import { advanceStatus } from "@/server/prospects/auto-status";
import { liveSubscription, publish, threadTopic, workspaceTopic } from "@/server/realtime";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { hitRateLimit } from "@/server/tracking/rate-limit";
import { visitForToken } from "@/server/tracking/visits";
import { workspaceAvailable } from "./presence";

/**
 * The visitor's side of the live chat and the callback form (§7.4, §7.5).
 * Like the tracking routes this runs on the system connection, scoped to
 * the workspace resolved from the host. The visitor proves access with the
 * visit token (in page memory) and, once a thread exists, a chat token the
 * widget keeps in sessionStorage so a reload does not lose the conversation.
 */

const CHAT_TOKEN_TTL = 3 * 24 * 60 * 60;

function secret() {
  return serverEnv().BETTER_AUTH_SECRET;
}

export function toMessageView(row: typeof chatMessages.$inferSelect): ChatMessageView {
  return {
    id: row.id,
    threadId: row.threadId,
    author: row.author,
    kind: row.kind,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

type Visit = NonNullable<Awaited<ReturnType<typeof visitForToken>>>;

async function threadForToken(db: Database | Transaction, workspaceId: string, token: string) {
  const threadId = await verifyToken(secret(), "chat", token);
  if (!threadId || !/^[0-9a-f-]{36}$/.test(threadId)) return null;
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.workspaceId, workspaceId), eq(chatThreads.id, threadId)));
  return thread ?? null;
}

export interface ThreadAccess {
  chat: string;
  live: RealtimeSubscription;
}

async function access(threadId: string): Promise<ThreadAccess> {
  return {
    chat: await signToken(secret(), "chat", threadId, CHAT_TOKEN_TTL),
    live: await liveSubscription(threadTopic(threadId)),
  };
}

export type VisitorMessageResult =
  { message: ChatMessageView; access?: ThreadAccess } | { error: "invalid" | "limited" };

/** A visitor message; the first one opens the thread. */
export async function postVisitorMessage(
  db: Database,
  input: { workspaceId: string; body: unknown },
): Promise<VisitorMessageResult> {
  const parsed = visitorMessageSchema.safeParse(input.body);
  if (!parsed.success) return { error: "invalid" };
  const visit = await visitForToken(db, input.workspaceId, parsed.data.token);
  if (!visit) return { error: "invalid" };
  if (!(await hitRateLimit(db, `chat:msg:${visit.id}`, 30, 600))) return { error: "limited" };

  const result = await db.transaction(async (tx) => {
    let thread: typeof chatThreads.$inferSelect | null | undefined = parsed.data.chat
      ? await threadForToken(tx, input.workspaceId, parsed.data.chat)
      : null;
    if (thread && thread.prospectId !== visit.prospectId) return null;
    let created = false;
    if (!thread) {
      // Same visit, lost token (e.g. a second tab): continue its thread.
      [thread] = await tx
        .select()
        .from(chatThreads)
        .where(
          and(eq(chatThreads.workspaceId, input.workspaceId), eq(chatThreads.visitId, visit.id)),
        )
        .limit(1);
    }
    if (!thread) {
      [thread] = await tx
        .insert(chatThreads)
        .values({
          workspaceId: input.workspaceId,
          prospectId: visit.prospectId,
          exposeId: visit.exposeId,
          visitId: visit.id,
        })
        .returning();
      created = true;
    }
    const now = new Date();
    const [message] = await tx
      .insert(chatMessages)
      .values({
        workspaceId: input.workspaceId,
        threadId: thread!.id,
        author: "visitor",
        body: parsed.data.body,
        visitId: visit.id,
        createdAt: now,
      })
      .returning();
    await tx
      .update(chatThreads)
      .set({ status: "open", lastMessageAt: now, lastVisitorMessageAt: now })
      .where(and(eq(chatThreads.workspaceId, input.workspaceId), eq(chatThreads.id, thread!.id)));
    // Sent: the draft is gone, its longest length stays as a signal.
    await tx
      .update(chatDrafts)
      .set({ length: 0, content: null, threadId: thread!.id, updatedAt: now })
      .where(and(eq(chatDrafts.workspaceId, input.workspaceId), eq(chatDrafts.visitId, visit.id)));
    await recordServerEvent(tx, input.workspaceId, visit, "chat_message_sent", {
      threadId: thread!.id,
      length: parsed.data.body.length,
    });
    if (!visit.quiet) {
      await advanceStatus(tx, {
        workspaceId: input.workspaceId,
        prospectId: visit.prospectId,
        to: "contacted",
        via: "chat",
        meta: { threadId: thread!.id },
      });
    }
    return { thread: thread!, message: message!, created };
  });
  if (!result) return { error: "invalid" };

  const view = toMessageView(result.message);
  await publish(
    [workspaceTopic(input.workspaceId), threadTopic(result.thread.id)],
    "chat.message",
    { message: view, prospectId: result.thread.prospectId },
  );
  if (!visit.quiet) {
    const { thread } = result;
    await defer(async () => {
      const company = await companyOf(db, input.workspaceId, thread.prospectId);
      await processProspect(db, {
        workspaceId: input.workspaceId,
        prospectId: thread.prospectId,
        cause: {
          workspaceId: input.workspaceId,
          trigger: "chat_message",
          prospectId: thread.prospectId,
          // One notification per conversation burst; each message updates the push.
          groupKey: `chat:${thread.id}`,
          url: notificationUrl({ trigger: "chat_message", threadId: thread.id }),
          action: { title: "Zum Kunden", url: `/kunden/${thread.prospectId}` },
          ...notificationCopy({ trigger: "chat_message", company, message: parsed.data.body }),
        },
      });
    });
  }
  return {
    message: view,
    ...(result.created || !parsed.data.chat ? { access: await access(result.thread.id) } : {}),
  };
}

async function recordServerEvent(
  tx: Transaction,
  workspaceId: string,
  visit: Pick<Visit, "id" | "exposeId">,
  type: "chat_message_sent" | "callback_submitted",
  payload: Record<string, unknown>,
) {
  await tx.insert(events).values({
    workspaceId,
    visitId: visit.id,
    exposeId: visit.exposeId,
    type,
    payload,
    occurredAt: new Date(),
  });
  await tx
    .update(visits)
    .set({ lastSeenAt: new Date(), eventCount: sql`${visits.eventCount} + 1` })
    .where(and(eq(visits.workspaceId, workspaceId), eq(visits.id, visit.id)));
}

export type ThreadState = {
  messages: ChatMessageView[];
  access: ThreadAccess;
  contact: { name: string | null; channel: "email" | "phone" | "whatsapp" | null };
  available: boolean;
};

/** The visitor reopens the chat (reload, reconnect): the thread so far. */
export async function readVisitorThread(
  db: Database,
  input: { workspaceId: string; body: unknown },
): Promise<ThreadState | null> {
  const parsed = chatReadSchema.safeParse(input.body);
  if (!parsed.success) return null;
  const thread = await threadForToken(db, input.workspaceId, parsed.data.chat);
  if (!thread) return null;
  const after = parsed.data.after
    ? await db
        .select({ createdAt: chatMessages.createdAt })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.workspaceId, input.workspaceId),
            eq(chatMessages.threadId, thread.id),
            eq(chatMessages.id, parsed.data.after),
          ),
        )
        .then((rows) => rows[0]?.createdAt ?? null)
    : null;
  const rows = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.workspaceId, input.workspaceId),
        eq(chatMessages.threadId, thread.id),
        after ? gt(chatMessages.createdAt, after) : undefined,
      ),
    )
    .orderBy(asc(chatMessages.createdAt))
    .limit(200);
  return {
    messages: rows.map(toMessageView),
    access: await access(thread.id),
    contact: { name: thread.visitorName, channel: thread.returnChannel },
    available: await workspaceAvailable(db, input.workspaceId),
  };
}

/**
 * Typing in the chat (§7.5 „Entwurfserkennung“): the length always, the
 * text only if the workspace enabled it (the widget then says so). Also
 * feeds the owner's typing indicator.
 */
export async function recordVisitorTyping(
  db: Database,
  input: { workspaceId: string; body: unknown },
): Promise<"ok" | "invalid" | "limited"> {
  const parsed = visitorTypingSchema.safeParse(input.body);
  if (!parsed.success) return "invalid";
  const visit = await visitForToken(db, input.workspaceId, parsed.data.token);
  if (!visit) return "invalid";
  if (!(await hitRateLimit(db, `chat:typing:${visit.id}`, 400, 600))) return "limited";
  const thread = parsed.data.chat
    ? await threadForToken(db, input.workspaceId, parsed.data.chat)
    : null;
  if (thread && thread.prospectId !== visit.prospectId) return "invalid";
  const settings = await loadWorkspaceSettings(db, input.workspaceId);
  const content =
    settings.chat.storeDraftContent && parsed.data.content && parsed.data.length > 0
      ? parsed.data.content
      : null;
  const { length } = parsed.data;
  const [before] = await db
    .select({ maxLength: chatDrafts.maxLength })
    .from(chatDrafts)
    .where(and(eq(chatDrafts.workspaceId, input.workspaceId), eq(chatDrafts.visitId, visit.id)));
  await db
    .insert(chatDrafts)
    .values({
      workspaceId: input.workspaceId,
      prospectId: visit.prospectId,
      visitId: visit.id,
      threadId: thread?.id ?? null,
      length,
      maxLength: length,
      content,
    })
    .onConflictDoUpdate({
      target: [chatDrafts.workspaceId, chatDrafts.visitId],
      set: {
        length,
        maxLength: sql`greatest(${chatDrafts.maxLength}, ${length})`,
        content,
        threadId: sql`coalesce(${chatDrafts.threadId}, ${thread?.id ?? null}::uuid)`,
        updatedAt: sql`now()`,
      },
    });
  await publish([workspaceTopic(input.workspaceId)], "chat.typing", {
    threadId: thread?.id ?? null,
    prospectId: visit.prospectId,
    author: "visitor",
    length,
  });
  // The score only changes when the draft passes 3 or 20 characters (§7.6).
  const previous = before?.maxLength ?? 0;
  if (!visit.quiet && [SHORT_DRAFT, LONG_DRAFT].some((n) => previous < n && length >= n)) {
    await defer(() =>
      processProspect(db, { workspaceId: input.workspaceId, prospectId: visit.prospectId }),
    );
  }
  return "ok";
}

export type FormResult = { ok: true } | { error: "invalid"; fields?: Record<string, string> };

/** „Wie erreiche ich Sie, falls Sie das Fenster schließen?“ (§7.5) */
export async function saveReturnChannel(
  db: Database,
  input: { workspaceId: string; body: unknown },
): Promise<FormResult | { error: "limited" }> {
  const parsed = returnChannelSchema.safeParse(input.body);
  if (!parsed.success) return { error: "invalid", fields: issuesByField(parsed.error) };
  const thread = await threadForToken(db, input.workspaceId, parsed.data.chat);
  if (!thread) return { error: "invalid" };
  if (!(await hitRateLimit(db, `chat:contact:${thread.id}`, 10, 3600))) return { error: "limited" };
  await db
    .update(chatThreads)
    .set({
      visitorName: parsed.data.name ?? thread.visitorName,
      returnChannel: parsed.data.channel,
      visitorEmail: parsed.data.channel === "email" ? parsed.data.email : thread.visitorEmail,
      visitorPhone: parsed.data.channel === "email" ? thread.visitorPhone : parsed.data.phone,
    })
    .where(and(eq(chatThreads.workspaceId, input.workspaceId), eq(chatThreads.id, thread.id)));
  await publish([workspaceTopic(input.workspaceId)], "chat.thread", {
    threadId: thread.id,
    prospectId: thread.prospectId,
  });
  return { ok: true };
}

/**
 * The automatic notice two minutes after an unanswered message (§7.5). The
 * widget asks for it when its timer runs out; the server decides, so it
 * goes out once per unanswered stretch however many tabs ask.
 */
export async function sendOfflineNotice(
  db: Database,
  input: { workspaceId: string; body: unknown },
): Promise<{ message: ChatMessageView | null } | null> {
  const parsed = chatReadSchema.safeParse(input.body);
  if (!parsed.success) return null;
  const known = await threadForToken(db, input.workspaceId, parsed.data.chat);
  if (!known) return null;
  const settings = await loadWorkspaceSettings(db, input.workspaceId);
  const result = await db.transaction(async (tx) => {
    const [thread] = await tx
      .select()
      .from(chatThreads)
      .where(and(eq(chatThreads.workspaceId, input.workspaceId), eq(chatThreads.id, known.id)))
      .for("update");
    if (!thread || !offlineNoticeDue(thread)) return null;
    const alternatives = contactLinks({
      channels: ["whatsapp", "phone", "email"],
      settings: settings.channels,
      message: undefined,
      company: "",
      refCode: "",
    }).map((link) =>
      link.channel === "whatsapp"
        ? "per WhatsApp"
        : link.channel === "phone"
          ? `telefonisch unter ${link.display}`
          : `per E-Mail an ${link.display}`,
    );
    const now = new Date();
    const [message] = await tx
      .insert(chatMessages)
      .values({
        workspaceId: input.workspaceId,
        threadId: thread.id,
        author: "system",
        kind: "offline",
        body: offlineNoticeText(settings.chat.offlineMessage, alternatives),
        createdAt: now,
      })
      .returning();
    await tx
      .update(chatThreads)
      .set({ offlineNoticeAt: now, lastMessageAt: now })
      .where(and(eq(chatThreads.workspaceId, input.workspaceId), eq(chatThreads.id, thread.id)));
    return { thread, message: message! };
  });
  if (!result) return { message: null };
  const view = toMessageView(result.message);
  await publish(
    [workspaceTopic(input.workspaceId), threadTopic(result.thread.id)],
    "chat.message",
    { message: view, prospectId: result.thread.prospectId },
  );
  return { message: view };
}

/** „Rückruf anfordern“ (§7.4). Works without a visit token, e.g. with tracking blocked. */
export async function createCallbackRequest(
  db: Database,
  input: { workspaceId: string; body: unknown; internal: boolean },
): Promise<FormResult | { error: "not_found" | "limited" }> {
  const parsed = callbackRequestSchema.safeParse(input.body);
  if (!parsed.success) return { error: "invalid", fields: issuesByField(parsed.error) };
  const [expose] = await db
    .select({ id: exposes.id, prospectId: exposes.prospectId })
    .from(exposes)
    .where(
      and(
        eq(exposes.workspaceId, input.workspaceId),
        eq(exposes.slug, parsed.data.slug),
        isNull(exposes.unpublishedAt),
      ),
    );
  if (!expose) return { error: "not_found" };
  if (!(await hitRateLimit(db, `callback:${expose.id}`, 10, 3600))) return { error: "limited" };
  const visit = parsed.data.token
    ? await visitForToken(db, input.workspaceId, parsed.data.token)
    : null;
  const ownVisit = visit && visit.exposeId === expose.id ? visit : null;

  const request = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(callbackRequests)
      .values({
        workspaceId: input.workspaceId,
        prospectId: expose.prospectId,
        exposeId: expose.id,
        visitId: ownVisit?.id ?? null,
        name: parsed.data.name,
        phone: parsed.data.phone,
        preferredTime: parsed.data.preferredTime ?? null,
        note: parsed.data.note ?? null,
      })
      .returning({ id: callbackRequests.id });
    if (ownVisit) {
      await recordServerEvent(tx, input.workspaceId, ownVisit, "callback_submitted", {
        callbackId: row!.id,
      });
    }
    if (!input.internal && !ownVisit?.quiet) {
      await advanceStatus(tx, {
        workspaceId: input.workspaceId,
        prospectId: expose.prospectId,
        to: "contacted",
        via: "callback",
        meta: { callbackId: row!.id },
      });
    }
    return row!;
  });
  await publish([workspaceTopic(input.workspaceId)], "callback.created", {
    id: request.id,
    prospectId: expose.prospectId,
    name: parsed.data.name,
  });
  if (!input.internal && !ownVisit?.quiet) {
    await defer(async () => {
      const company = await companyOf(db, input.workspaceId, expose.prospectId);
      await processProspect(db, {
        workspaceId: input.workspaceId,
        prospectId: expose.prospectId,
        cause: {
          workspaceId: input.workspaceId,
          trigger: "callback",
          prospectId: expose.prospectId,
          groupKey: `callback:${request.id}`,
          url: notificationUrl({ trigger: "callback", prospectId: expose.prospectId }),
          ...notificationCopy({
            trigger: "callback",
            company,
            name: parsed.data.name,
            phone: parsed.data.phone,
            preferredTime: parsed.data.preferredTime ?? null,
          }),
        },
      });
    });
  }
  return { ok: true };
}

async function companyOf(db: Database, workspaceId: string, prospectId: string) {
  const [row] = await db
    .select({ company: prospects.companyName })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospectId)));
  return row?.company ?? "Ein Interessent";
}
