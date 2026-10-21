"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { ownerMessageSchema } from "@/domain/chat";
import type { ChatMessageView } from "@/domain/realtime";
import {
  markThreadRead,
  postOwnerMessage,
  threadProspect,
  setCallbackDone,
  setThreadStatus,
  chatInboxCount,
} from "@/server/chat/owner";
import { presenceBeat, setAvailability as storeAvailability } from "@/server/chat/presence";
import { publish, threadTopic } from "@/server/realtime";
import { requireCockpit } from "@/server/session";

/** Cockpit side of the live chat (§7.5). */

async function responder() {
  const context = await requireCockpit();
  assertCan(context.actor, "chat.reply", { workspaceId: context.workspace.id });
  return context;
}

export type SendResult = { ok: true; message: ChatMessageView } | { ok: false; message: string };

export async function sendOwnerMessage(
  threadId: string,
  body: string,
  kind: "text" | "handover" = "text",
): Promise<SendResult> {
  const { workspace, user, tenant } = await responder();
  const parsed = ownerMessageSchema.safeParse({ threadId, body: kind === "handover" ? "-" : body });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Nachricht." };
  }
  const result = await tenant((tx) =>
    postOwnerMessage(tx, {
      workspaceId: workspace.id,
      userId: user.id,
      threadId: parsed.data.threadId,
      body: parsed.data.body,
      kind,
    }),
  );
  if (!result) return { ok: false, message: "Diesen Chat gibt es nicht mehr." };
  await result.afterCommit();
  return { ok: true, message: result.message };
}

/** Owner typing indicator for the visitor; throttled by the client. */
export async function ownerTyping(threadId: string, typing: boolean): Promise<void> {
  const { workspace, tenant } = await responder();
  const id = z.uuid().safeParse(threadId);
  if (!id.success || typeof typing !== "boolean") return;
  // Only threads of this workspace (RLS) get the indicator.
  const prospectId = await tenant((tx) => threadProspect(tx, workspace.id, id.data));
  if (!prospectId) return;
  await publish([threadTopic(id.data)], "chat.typing", {
    threadId: id.data,
    prospectId,
    author: "owner",
    typing,
  });
}

export async function markRead(threadId: string): Promise<number> {
  const { workspace, tenant } = await responder();
  const id = z.uuid().safeParse(threadId);
  if (!id.success) return 0;
  return tenant(async (tx) => {
    await markThreadRead(tx, workspace.id, id.data);
    return chatInboxCount(tx, workspace.id);
  });
}

export async function unreadCount(): Promise<number> {
  const { workspace, tenant } = await responder();
  return tenant((tx) => chatInboxCount(tx, workspace.id));
}

export async function changeThreadStatus(threadId: string, status: "open" | "closed") {
  const { workspace, tenant } = await responder();
  const id = z.uuid().safeParse(threadId);
  const parsedStatus = z.enum(["open", "closed"]).safeParse(status);
  if (!id.success || !parsedStatus.success) return;
  await tenant((tx) => setThreadStatus(tx, workspace.id, id.data, parsedStatus.data));
  revalidatePath("/chat");
  revalidatePath(`/chat/${id.data}`);
}

/** Returns the new count for the Chat menu badge. */
export async function markCallback(id: string, done: boolean): Promise<number | undefined> {
  const { workspace, user, tenant } = await responder();
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return;
  const inbox = await tenant(async (tx) => {
    await setCallbackDone(tx, {
      workspaceId: workspace.id,
      userId: user.id,
      id: parsed.data,
      done,
    });
    return chatInboxCount(tx, workspace.id);
  });
  revalidatePath("/chat");
  revalidatePath("/");
  revalidatePath("/kunden", "layout");
  return inbox;
}

/** A cockpit tab is open (§7.4 „Verfügbar“). */
export async function beat(): Promise<void> {
  const { workspace, user, tenant } = await requireCockpit();
  await tenant((tx) => presenceBeat(tx, workspace.id, user.id));
}

export async function setAvailability(value: "auto" | "available" | "away") {
  const { workspace, user, tenant } = await requireCockpit();
  const parsed = z.enum(["auto", "available", "away"]).safeParse(value);
  if (!parsed.success) return;
  await tenant((tx) => storeAvailability(tx, workspace.id, user.id, parsed.data));
  revalidatePath("/chat");
}
