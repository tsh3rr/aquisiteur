import "server-only";
import { and, asc, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import {
  callbackRequests,
  chatDrafts,
  chatMessages,
  chatThreads,
  exposes,
  prospects,
} from "@/db/schema";
import { HANDOVER_TEXT } from "@/domain/chat";
import type { ChatMessageView } from "@/domain/realtime";
import { publish, threadTopic, workspaceTopic } from "@/server/realtime";
import { toMessageView } from "./visitor";

/**
 * The owner's side of the live chat and callbacks (§7.5, §7.8). Runs as
 * tenant (RLS) inside withTenant; publishing happens after the transaction
 * by the caller via `afterCommit`.
 */

/** Visitor messages after the owner last looked count as unread. */
const unreadSql = sql<number>`(
  select count(*)::int from ${chatMessages}
  where ${chatMessages.workspaceId} = ${chatThreads.workspaceId}
    and ${chatMessages.threadId} = ${chatThreads.id}
    and ${chatMessages.author} = 'visitor'
    and (${chatThreads.ownerReadAt} is null or ${chatMessages.createdAt} > ${chatThreads.ownerReadAt})
)`;

export interface ThreadListItem {
  id: string;
  prospectId: string;
  companyName: string;
  visitorName: string | null;
  status: "open" | "closed";
  lastMessageAt: Date;
  preview: string | null;
  previewAuthor: "visitor" | "owner" | "system" | null;
  unread: number;
}

export async function listThreads(
  tx: Transaction,
  workspaceId: string,
  options: { prospectId?: string; limit?: number } = {},
): Promise<ThreadListItem[]> {
  const last = tx
    .select({
      threadId: chatMessages.threadId,
      body: chatMessages.body,
      author: chatMessages.author,
      rank: sql<number>`row_number() over (partition by ${chatMessages.threadId} order by ${chatMessages.createdAt} desc)`.as(
        "rank",
      ),
    })
    .from(chatMessages)
    .where(eq(chatMessages.workspaceId, workspaceId))
    .as("last");
  const rows = await tx
    .select({
      id: chatThreads.id,
      prospectId: chatThreads.prospectId,
      companyName: prospects.companyName,
      visitorName: chatThreads.visitorName,
      status: chatThreads.status,
      lastMessageAt: chatThreads.lastMessageAt,
      preview: last.body,
      previewAuthor: last.author,
      unread: unreadSql,
    })
    .from(chatThreads)
    .innerJoin(
      prospects,
      and(
        eq(prospects.workspaceId, chatThreads.workspaceId),
        eq(prospects.id, chatThreads.prospectId),
      ),
    )
    .leftJoin(last, and(eq(last.threadId, chatThreads.id), eq(last.rank, 1)))
    .where(
      and(
        eq(chatThreads.workspaceId, workspaceId),
        options.prospectId ? eq(chatThreads.prospectId, options.prospectId) : undefined,
      ),
    )
    .orderBy(desc(chatThreads.lastMessageAt))
    .limit(options.limit ?? 100);
  return rows.map((row) => ({ ...row, unread: Number(row.unread) }));
}

export async function unreadThreadCount(tx: Transaction, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(chatThreads)
    .where(and(eq(chatThreads.workspaceId, workspaceId), sql`${unreadSql} > 0`));
  return row?.value ?? 0;
}

export interface ThreadDetail {
  thread: typeof chatThreads.$inferSelect;
  prospect: { id: string; companyName: string };
  exposeSlug: string;
  refCode: string;
  messages: ChatMessageView[];
  /** Unsent text of this thread's visitor, if the workspace stores it. */
  draft: { length: number; content: string | null; updatedAt: Date } | null;
}

export async function loadThread(
  tx: Transaction,
  workspaceId: string,
  threadId: string,
): Promise<ThreadDetail | null> {
  const [row] = await tx
    .select({
      thread: chatThreads,
      prospect: { id: prospects.id, companyName: prospects.companyName },
      exposeSlug: exposes.slug,
      refCode: exposes.refCode,
    })
    .from(chatThreads)
    .innerJoin(
      prospects,
      and(
        eq(prospects.workspaceId, chatThreads.workspaceId),
        eq(prospects.id, chatThreads.prospectId),
      ),
    )
    .innerJoin(
      exposes,
      and(eq(exposes.workspaceId, chatThreads.workspaceId), eq(exposes.id, chatThreads.exposeId)),
    )
    .where(and(eq(chatThreads.workspaceId, workspaceId), eq(chatThreads.id, threadId)));
  if (!row) return null;
  const messages = await tx
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.workspaceId, workspaceId), eq(chatMessages.threadId, threadId)))
    .orderBy(asc(chatMessages.createdAt))
    .limit(500);
  const [draft] = await tx
    .select({
      length: chatDrafts.length,
      content: chatDrafts.content,
      updatedAt: chatDrafts.updatedAt,
    })
    .from(chatDrafts)
    .where(
      and(
        eq(chatDrafts.workspaceId, workspaceId),
        eq(chatDrafts.threadId, threadId),
        gt(chatDrafts.length, 0),
      ),
    )
    .orderBy(desc(chatDrafts.updatedAt))
    .limit(1);
  return { ...row, messages: messages.map(toMessageView), draft: draft ?? null };
}

export async function threadProspect(
  tx: Transaction,
  workspaceId: string,
  threadId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ prospectId: chatThreads.prospectId })
    .from(chatThreads)
    .where(and(eq(chatThreads.workspaceId, workspaceId), eq(chatThreads.id, threadId)));
  return row?.prospectId ?? null;
}

export async function markThreadRead(tx: Transaction, workspaceId: string, threadId: string) {
  await tx
    .update(chatThreads)
    .set({ ownerReadAt: new Date() })
    .where(and(eq(chatThreads.workspaceId, workspaceId), eq(chatThreads.id, threadId)));
}

export interface Published {
  /** Run after the transaction committed. */
  afterCommit: () => Promise<void>;
}

export async function postOwnerMessage(
  tx: Transaction,
  input: {
    workspaceId: string;
    userId: string;
    threadId: string;
    body: string;
    kind?: "text" | "handover";
  },
): Promise<(Published & { message: ChatMessageView }) | null> {
  const [thread] = await tx
    .select({ id: chatThreads.id, prospectId: chatThreads.prospectId })
    .from(chatThreads)
    .where(and(eq(chatThreads.workspaceId, input.workspaceId), eq(chatThreads.id, input.threadId)));
  if (!thread) return null;
  const now = new Date();
  const [row] = await tx
    .insert(chatMessages)
    .values({
      workspaceId: input.workspaceId,
      threadId: thread.id,
      author: "owner",
      authorUserId: input.userId,
      kind: input.kind ?? "text",
      body: input.kind === "handover" ? HANDOVER_TEXT : input.body,
      createdAt: now,
    })
    .returning();
  await tx
    .update(chatThreads)
    .set({ status: "open", lastMessageAt: now, lastOwnerMessageAt: now, ownerReadAt: now })
    .where(and(eq(chatThreads.workspaceId, input.workspaceId), eq(chatThreads.id, thread.id)));
  const message = toMessageView(row!);
  return {
    message,
    afterCommit: () =>
      publish([workspaceTopic(input.workspaceId), threadTopic(thread.id)], "chat.message", {
        message,
        prospectId: thread.prospectId,
      }),
  };
}

export async function setThreadStatus(
  tx: Transaction,
  workspaceId: string,
  threadId: string,
  status: "open" | "closed",
): Promise<boolean> {
  const rows = await tx
    .update(chatThreads)
    .set({ status })
    .where(and(eq(chatThreads.workspaceId, workspaceId), eq(chatThreads.id, threadId)))
    .returning({ id: chatThreads.id });
  return rows.length > 0;
}

export interface CallbackItem {
  id: string;
  prospectId: string;
  companyName: string;
  name: string;
  phone: string;
  preferredTime: string | null;
  note: string | null;
  status: "open" | "done";
  createdAt: Date;
  doneAt: Date | null;
}

export async function listCallbacks(
  tx: Transaction,
  workspaceId: string,
  options: { prospectId?: string; openOnly?: boolean } = {},
): Promise<CallbackItem[]> {
  return tx
    .select({
      id: callbackRequests.id,
      prospectId: callbackRequests.prospectId,
      companyName: prospects.companyName,
      name: callbackRequests.name,
      phone: callbackRequests.phone,
      preferredTime: callbackRequests.preferredTime,
      note: callbackRequests.note,
      status: callbackRequests.status,
      createdAt: callbackRequests.createdAt,
      doneAt: callbackRequests.doneAt,
    })
    .from(callbackRequests)
    .innerJoin(
      prospects,
      and(
        eq(prospects.workspaceId, callbackRequests.workspaceId),
        eq(prospects.id, callbackRequests.prospectId),
      ),
    )
    .where(
      and(
        eq(callbackRequests.workspaceId, workspaceId),
        options.prospectId ? eq(callbackRequests.prospectId, options.prospectId) : undefined,
        options.openOnly ? eq(callbackRequests.status, "open") : undefined,
      ),
    )
    .orderBy(desc(callbackRequests.createdAt))
    .limit(100);
}

export async function setCallbackDone(
  tx: Transaction,
  input: { workspaceId: string; userId: string; id: string; done: boolean },
): Promise<boolean> {
  const rows = await tx
    .update(callbackRequests)
    .set(
      input.done
        ? { status: "done", doneAt: new Date(), doneByUserId: input.userId }
        : { status: "open", doneAt: null, doneByUserId: null },
    )
    .where(
      and(eq(callbackRequests.workspaceId, input.workspaceId), eq(callbackRequests.id, input.id)),
    )
    .returning({ id: callbackRequests.id });
  return rows.length > 0;
}

/** Drafts that were typed but never sent, per prospect, for the timeline. */
export async function unsentDrafts(tx: Transaction, workspaceId: string, prospectId: string) {
  return tx
    .select({
      visitId: chatDrafts.visitId,
      length: chatDrafts.length,
      maxLength: chatDrafts.maxLength,
      content: chatDrafts.content,
      updatedAt: chatDrafts.updatedAt,
    })
    .from(chatDrafts)
    .where(
      and(
        eq(chatDrafts.workspaceId, workspaceId),
        eq(chatDrafts.prospectId, prospectId),
        or(gt(chatDrafts.length, 0), and(isNull(chatDrafts.threadId), gt(chatDrafts.maxLength, 0))),
      ),
    )
    .orderBy(desc(chatDrafts.updatedAt));
}
