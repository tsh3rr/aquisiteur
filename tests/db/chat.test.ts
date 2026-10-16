import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { signToken } from "@/domain/tracking/signed-token";
import { getInfra } from "@/infra";
import { publishExpose, type PublishResult } from "@/server/exposes/publish";
import {
  listCallbacks,
  listThreads,
  loadThread,
  markThreadRead,
  postOwnerMessage,
  unreadThreadCount,
} from "@/server/chat/owner";
import { presenceBeat, setAvailability, workspaceAvailable } from "@/server/chat/presence";
import {
  createCallbackRequest,
  postVisitorMessage,
  readVisitorThread,
  recordVisitorTyping,
  saveReturnChannel,
  sendOfflineNotice,
} from "@/server/chat/visitor";
import { workspaceTopic } from "@/server/realtime";
import { startVisit } from "@/server/tracking/visits";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/**
 * Phase 3: the live chat and callbacks, on the system connection like the
 * public routes, and the owner's side as tenant.
 */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const hanna = { id: "user-hanna", email: "hanna@h.test", name: "Hanna" };
const ivo = { id: "user-ivo", email: "ivo@i.test", name: "Ivo" };
let wsH = "";
let wsI = "";
let cafe: PublishResult;
let bakery: PublishResult;
let foreign: PublishResult;

const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function publish(userId: string, workspaceId: string, key: string, company: string) {
  return withTenant(db, { userId, workspaceId }, (tx) =>
    publishExpose(
      tx,
      { workspaceId, userId, source: "api" },
      { document: minimalExpose(key, company), assets: [] },
    ),
  );
}

async function visit(workspaceId: string, slug: string, internal = false) {
  const started = await startVisit(db, {
    workspaceId,
    body: { slug, viewport: { width: 390, height: 844 } },
    headers: new Headers({ "user-agent": PHONE }),
    internal,
  });
  if (!("token" in started)) throw new Error(`start failed: ${started.error}`);
  return started.token;
}

async function prospectStatus(id: string) {
  const [row] = await db.select().from(schema.prospects).where(eq(schema.prospects.id, id));
  return row!.status;
}

const asHanna = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(db, { userId: hanna.id, workspaceId: wsH }, fn);

/** Collects what the in-process realtime delivers on `topic`. */
async function listen(topic: string) {
  const { realtime } = getInfra();
  const subscription = await realtime.subscription(topic);
  if (subscription.kind !== "sse") throw new Error("expected the memory adapter");
  const controller = new AbortController();
  const stream = await realtime.stream!(subscription.token, controller.signal);
  const reader = stream!.getReader();
  const received: { event: string; payload: unknown }[] = [];
  const decoder = new TextDecoder();
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      for (const line of decoder.decode(value).split("\n")) {
        if (line.startsWith("data: ")) received.push(JSON.parse(line.slice(6)));
      }
    }
  })();
  return { received, stop: () => controller.abort() };
}

beforeAll(async () => {
  await db.insert(schema.users).values([hanna, ivo]);
  const h = await createWorkspace(db, { userId: hanna.id, name: "Agentur H", slug: "agentur-h" });
  const i = await createWorkspace(db, { userId: ivo.id, name: "Agentur I", slug: "agentur-i" });
  if (!h.ok || !i.ok) throw new Error("workspace setup failed");
  wsH = h.workspace.id;
  wsI = i.workspace.id;
  cafe = await publish(hanna.id, wsH, "cafe-mueller", "Café Müller");
  bakery = await publish(hanna.id, wsH, "baeckerei-korn", "Bäckerei Korn");
  foreign = await publish(ivo.id, wsI, "cafe-mueller", "Café Müller");
});

afterAll(async () => {
  await close();
});

describe("live chat", () => {
  let chat = "";
  let token = "";

  it("the first message opens a thread, reaches the cockpit live and marks contact", async () => {
    token = await visit(wsH, cafe.slug);
    const live = await listen(workspaceTopic(wsH));
    const result = await postVisitorMessage(db, {
      workspaceId: wsH,
      body: { token, body: "  Was kostet die Website?  " },
    });
    live.stop();
    if (!("message" in result)) throw new Error(`message failed: ${result.error}`);
    expect(result.message).toMatchObject({ author: "visitor", body: "Was kostet die Website?" });
    expect(result.access?.chat).toBeTruthy();
    expect(result.access?.live.kind).toBe("sse");
    chat = result.access!.chat;

    // The message, its notification and the new score; the score crossing 50 %
    // sends no second notification (one moment, one notification, §7.7).
    expect(live.received).toEqual([
      {
        event: "chat.message",
        payload: { message: result.message, prospectId: cafe.prospectId },
      },
      {
        event: "notification.created",
        payload: {
          id: expect.any(String),
          title: "Café Müller schreibt im Chat",
          url: `/kunden/${cafe.prospectId}`,
        },
      },
      {
        event: "intent.updated",
        payload: { prospectId: cafe.prospectId, score: 100, level: "confirmed" },
      },
    ]);
    expect(await prospectStatus(cafe.prospectId)).toBe("contacted");
    const sent = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.workspaceId, wsH), eq(schema.events.type, "chat_message_sent")));
    expect(sent).toHaveLength(1);
  });

  it("later messages continue the thread; a reload restores it from the chat token", async () => {
    const second = await postVisitorMessage(db, {
      workspaceId: wsH,
      body: { token, chat, body: "Und wie lange dauert das?" },
    });
    expect("message" in second && second.access).toBeUndefined();
    const restored = await readVisitorThread(db, { workspaceId: wsH, body: { chat } });
    expect(restored?.messages.map((m) => m.body)).toEqual([
      "Was kostet die Website?",
      "Und wie lange dauert das?",
    ]);
    // A reload is a new visit: the token still opens the same thread.
    const reloaded = await visit(wsH, cafe.slug);
    const third = await postVisitorMessage(db, {
      workspaceId: wsH,
      body: { token: reloaded, chat, body: "Hallo?" },
    });
    expect("message" in third && third.message.threadId).toBe(restored?.messages[0]?.threadId);
  });

  it("refuses chat tokens of other prospects, other workspaces and forgeries", async () => {
    const bakeryToken = await visit(wsH, bakery.slug);
    expect(
      await postVisitorMessage(db, {
        workspaceId: wsH,
        body: { token: bakeryToken, chat, body: "Fremder Chat" },
      }),
    ).toEqual({ error: "invalid" });
    expect(await readVisitorThread(db, { workspaceId: wsI, body: { chat } })).toBeNull();
    const forged = await signToken("wrong-secret-wrong-secret-wrong-secret", "chat", "x", 60);
    expect(await readVisitorThread(db, { workspaceId: wsH, body: { chat: forged } })).toBeNull();
  });

  it("the owner sees it unread, answers, and the visitor gets the answer", async () => {
    const [thread] = await asHanna((tx) => listThreads(tx, wsH));
    expect(thread).toMatchObject({ companyName: "Café Müller", unread: 3, preview: "Hallo?" });
    expect(await asHanna((tx) => unreadThreadCount(tx, wsH))).toBe(1);

    const reply = await asHanna((tx) =>
      postOwnerMessage(tx, {
        workspaceId: wsH,
        userId: hanna.id,
        threadId: thread!.id,
        body: "Gern, ich schicke Ihnen ein Angebot.",
      }),
    );
    await reply!.afterCommit();
    expect(await asHanna((tx) => unreadThreadCount(tx, wsH))).toBe(0);
    const restored = await readVisitorThread(db, { workspaceId: wsH, body: { chat } });
    expect(restored?.messages.at(-1)).toMatchObject({ author: "owner", kind: "text" });

    // Another workspace's member cannot see or answer it.
    expect(
      await withTenant(db, { userId: ivo.id, workspaceId: wsI }, (tx) =>
        loadThread(tx, wsI, thread!.id),
      ),
    ).toBeNull();
    expect(
      await withTenant(db, { userId: ivo.id, workspaceId: wsI }, (tx) =>
        postOwnerMessage(tx, { workspaceId: wsI, userId: ivo.id, threadId: thread!.id, body: "x" }),
      ),
    ).toBeNull();
  });

  it("stores the return channel the visitor leaves", async () => {
    expect(
      await saveReturnChannel(db, {
        workspaceId: wsH,
        body: { chat, channel: "email", email: "kein-email" },
      }),
    ).toMatchObject({ error: "invalid", fields: { email: expect.any(String) } });
    expect(
      await saveReturnChannel(db, {
        workspaceId: wsH,
        body: { chat, channel: "whatsapp", name: "Sabine Müller", phone: "0170 1234567" },
      }),
    ).toEqual({ ok: true });
    const [thread] = await asHanna((tx) => listThreads(tx, wsH));
    const detail = await asHanna((tx) => loadThread(tx, wsH, thread!.id));
    expect(detail?.thread).toMatchObject({
      visitorName: "Sabine Müller",
      returnChannel: "whatsapp",
      visitorPhone: "0170 1234567",
    });
  });

  it("sends the offline notice once, two minutes after an unanswered message", async () => {
    const [thread] = await asHanna((tx) => listThreads(tx, wsH));
    await postVisitorMessage(db, {
      workspaceId: wsH,
      body: { token, chat, body: "Sind Sie noch da?" },
    });
    // Too early: nothing.
    expect(await sendOfflineNotice(db, { workspaceId: wsH, body: { chat } })).toEqual({
      message: null,
    });
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    await db
      .update(schema.chatThreads)
      .set({
        lastVisitorMessageAt: threeMinutesAgo,
        lastOwnerMessageAt: new Date(Date.now() - 10 * 60 * 1000),
      })
      .where(eq(schema.chatThreads.id, thread!.id));
    const notice = await sendOfflineNotice(db, { workspaceId: wsH, body: { chat } });
    expect(notice?.message).toMatchObject({ author: "system", kind: "offline" });
    expect(notice?.message?.body).toMatch(/melde mich so bald wie möglich/);
    expect(await sendOfflineNotice(db, { workspaceId: wsH, body: { chat } })).toEqual({
      message: null,
    });
  });
});

describe("draft detection", () => {
  it("keeps only the length unless the workspace stores draft content", async () => {
    const token = await visit(wsH, bakery.slug);
    await recordVisitorTyping(db, {
      workspaceId: wsH,
      body: { token, length: 18, content: "Ich hätte gern ein" },
    });
    const [lengthOnly] = await db
      .select()
      .from(schema.chatDrafts)
      .where(eq(schema.chatDrafts.prospectId, bakery.prospectId));
    expect(lengthOnly).toMatchObject({ length: 18, maxLength: 18, content: null });

    await db
      .update(schema.workspaceSettings)
      .set({ chat: { storeDraftContent: true } })
      .where(eq(schema.workspaceSettings.workspaceId, wsH));
    await recordVisitorTyping(db, {
      workspaceId: wsH,
      body: { token, length: 7, content: "Ich hät" },
    });
    const [withContent] = await db
      .select()
      .from(schema.chatDrafts)
      .where(eq(schema.chatDrafts.prospectId, bakery.prospectId));
    expect(withContent).toMatchObject({ length: 7, maxLength: 18, content: "Ich hät" });
    // Bakery is not contacted by typing alone.
    expect(await prospectStatus(bakery.prospectId)).toBe("opened");
  });
});

describe("callback requests", () => {
  it("validates, stores and marks contact; the owner's device does not", async () => {
    const base = { slug: bakery.slug, name: "Anna Korn", phone: "0341 123456" };
    expect(
      await createCallbackRequest(db, {
        workspaceId: wsH,
        body: { ...base, website: "http://spam" },
        internal: false,
      }),
    ).toMatchObject({ error: "invalid" });
    expect(
      await createCallbackRequest(db, {
        workspaceId: wsH,
        body: { ...base, preferredTime: "Dienstag ab 15 Uhr" },
        internal: true,
      }),
    ).toEqual({ ok: true });
    expect(await prospectStatus(bakery.prospectId)).toBe("opened");
    expect(
      await createCallbackRequest(db, {
        workspaceId: wsH,
        body: { ...base, token: await visit(wsH, bakery.slug) },
        internal: false,
      }),
    ).toEqual({ ok: true });
    expect(await prospectStatus(bakery.prospectId)).toBe("contacted");
    const open = await asHanna((tx) => listCallbacks(tx, wsH, { openOnly: true }));
    expect(open.map((c) => [c.companyName, c.preferredTime])).toEqual([
      ["Bäckerei Korn", null],
      ["Bäckerei Korn", "Dienstag ab 15 Uhr"],
    ]);
    // A slug is only valid on its own workspace's host.
    expect(
      await createCallbackRequest(db, {
        workspaceId: wsI,
        body: { ...base, slug: cafe.slug },
        internal: false,
      }),
    ).toEqual({ error: "not_found" });
    expect(foreign.slug).not.toBe(cafe.slug);
  });
});

describe("availability", () => {
  it("is shown while a cockpit reports in or when set by hand", async () => {
    expect(await workspaceAvailable(db, wsI)).toBe(false);
    await withTenant(db, { userId: ivo.id, workspaceId: wsI }, (tx) =>
      presenceBeat(tx, wsI, ivo.id),
    );
    expect(await workspaceAvailable(db, wsI)).toBe(true);
    await withTenant(db, { userId: ivo.id, workspaceId: wsI }, (tx) =>
      setAvailability(tx, wsI, ivo.id, "away"),
    );
    expect(await workspaceAvailable(db, wsI)).toBe(false);
    expect(await workspaceAvailable(db, wsH)).toBe(false);
  });

  it("marks a thread read without touching others", async () => {
    const [thread] = await asHanna((tx) => listThreads(tx, wsH));
    await asHanna((tx) => markThreadRead(tx, wsH, thread!.id));
    expect(await asHanna((tx) => unreadThreadCount(tx, wsH))).toBe(0);
  });
});
