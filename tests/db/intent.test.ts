import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { getInfra } from "@/infra";
import { recordVisitorTyping } from "@/server/chat/visitor";
import { publishExpose, type PublishResult } from "@/server/exposes/publish";
import { recomputeIntent } from "@/server/intent/recompute";
import { notify } from "@/server/notifications/notify";
import { ingestEvents, startVisit } from "@/server/tracking/visits";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/**
 * Phase 4: the contact-intent score and the owner's notifications, on the
 * system connection like the public routes that trigger them.
 */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const jana = { id: "user-jana", email: "jana@j.test", name: "Jana" };
const kai = { id: "user-kai", email: "kai@k.test", name: "Kai" };
let wsJ = "";
let wsK = "";
let cafe: PublishResult;

const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const { push, email } = getInfra();
const pushes = vi.spyOn(push, "send");
const mails = vi.spyOn(email, "send");

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

async function scoreOf(workspaceId: string, prospectId: string) {
  const [row] = await db
    .select()
    .from(schema.intentScores)
    .where(
      and(
        eq(schema.intentScores.workspaceId, workspaceId),
        eq(schema.intentScores.prospectId, prospectId),
      ),
    );
  return row;
}

async function notificationsOf(workspaceId: string) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.workspaceId, workspaceId))
    .orderBy(desc(schema.notifications.createdAt));
}

beforeAll(async () => {
  await db.insert(schema.users).values([jana, kai]);
  const j = await createWorkspace(db, { userId: jana.id, name: "Agentur J", slug: "agentur-j" });
  const k = await createWorkspace(db, { userId: kai.id, name: "Agentur K", slug: "agentur-k" });
  if (!j.ok || !k.ok) throw new Error("workspace setup failed");
  wsJ = j.workspace.id;
  wsK = k.workspace.id;
  cafe = await withTenant(db, { userId: jana.id, workspaceId: wsJ }, (tx) =>
    publishExpose(
      tx,
      { workspaceId: wsJ, userId: jana.id, source: "api" },
      { document: minimalExpose("cafe-mueller", "Café Müller"), assets: [] },
    ),
  );
  await db.insert(schema.pushSubscriptions).values({
    workspaceId: wsJ,
    userId: jana.id,
    endpoint: "https://push.example/jana",
    p256dh: "key",
    auth: "secret",
  });
});

beforeEach(() => {
  pushes.mockClear();
  mails.mockClear();
});

afterAll(async () => {
  await close();
});

describe("intent score and notifications", () => {
  let token = "";

  it("new workspaces get the default rules (§7.7)", async () => {
    const rules = await withTenant(db, { userId: jana.id, workspaceId: wsJ }, (tx) =>
      tx.select().from(schema.notificationRules),
    );
    expect(
      rules
        .map((r) => [r.trigger, r.threshold, r.channels])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["chat_message", null, ["push"]],
      ["daily_digest", 8, ["email"]],
      ["first_visit", null, ["push"]],
      ["score_threshold", 50, ["push", "email"]],
    ]);
  });

  it("the first real visit notifies by push and starts the score", async () => {
    token = await visit(wsJ, cafe.slug);
    const [first] = await notificationsOf(wsJ);
    expect(first).toMatchObject({
      trigger: "first_visit",
      prospectId: cafe.prospectId,
      title: "Café Müller hat das Exposé geöffnet",
      channels: ["push"],
      suppressed: null,
    });
    expect(first!.pushedAt).toBeInstanceOf(Date);
    expect(pushes).toHaveBeenCalledTimes(1);
    expect(pushes.mock.calls[0]![0].endpoint).toBe("https://push.example/jana");
    expect(pushes.mock.calls[0]![1]).toMatchObject({ title: first!.title, tag: first!.id });
    expect(mails).not.toHaveBeenCalled();
  });

  it("reading raises the score without another notification", async () => {
    const result = await ingestEvents(db, {
      workspaceId: wsJ,
      body: {
        token,
        events: [
          { type: "heartbeat", at: 130_000, seconds: 130 },
          { type: "scroll_depth", at: 120_000, percent: 80 },
        ],
      },
    });
    expect(result).toBe("ok");
    const score = await scoreOf(wsJ, cafe.prospectId);
    expect(score?.score).toBe(14); // visit 5 % and read 10 %, noisy-or
    expect(score?.level).toBe("curious");
    expect(score?.signals.map((s) => s.id).sort()).toEqual(["read", "visit"]);
    expect(await notificationsOf(wsJ)).toHaveLength(1);
    expect(pushes).not.toHaveBeenCalled();
  });

  it("a long unsent chat draft passes 50 % and notifies by push and e-mail", async () => {
    for (const length of [5, 25]) {
      expect(await recordVisitorTyping(db, { workspaceId: wsJ, body: { token, length } })).toBe(
        "ok",
      );
    }
    const score = await scoreOf(wsJ, cafe.prospectId);
    expect(score!.score).toBeGreaterThanOrEqual(50);
    expect(score!.explanation.headline).toMatch(/^\d+ % – /);

    const [latest] = await notificationsOf(wsJ);
    expect(latest).toMatchObject({
      trigger: "score_threshold",
      groupKey: `score:${cafe.prospectId}:50`,
      channels: ["push", "email"],
    });
    expect(latest!.title).toContain("Café Müller:");
    expect(latest!.emailedAt).toBeInstanceOf(Date);
    expect(pushes).toHaveBeenCalledTimes(1);
    expect(mails).toHaveBeenCalledTimes(1);
    expect(mails.mock.calls[0]![0].to).toBe(jana.email);

    // Recomputing without new signals changes nothing and notifies nobody.
    const again = await recomputeIntent(db, wsJ, cafe.prospectId);
    expect(again?.before).toBe(score!.score);
    expect(await notificationsOf(wsJ)).toHaveLength(2);
  });

  it("groups updates within 30 minutes into one notification", async () => {
    const input = {
      workspaceId: wsJ,
      trigger: "chat_message" as const,
      prospectId: cafe.prospectId,
      groupKey: "chat:test",
      title: "Café Müller schreibt im Chat",
      body: "Hallo",
      url: `/kunden/${cafe.prospectId}`,
    };
    const now = new Date();
    const first = await notify(db, input, now);
    const second = await notify(
      db,
      { ...input, body: "Noch da?" },
      new Date(now.getTime() + 10 * 60_000),
    );
    expect(second).toMatchObject({ id: first!.id, update: true, channels: ["push"] });
    const later = await notify(db, input, new Date(now.getTime() + 50 * 60_000));
    expect(later!.id).not.toBe(first!.id);
    const grouped = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, first!.id));
    expect(grouped[0]).toMatchObject({ count: 2, body: "Noch da?" });
  });

  it("records but does not deliver during quiet hours", async () => {
    await db
      .update(schema.notificationRules)
      .set({ quietFrom: "00:00", quietTo: "23:59" })
      .where(
        and(
          eq(schema.notificationRules.workspaceId, wsJ),
          eq(schema.notificationRules.trigger, "chat_message"),
        ),
      );
    const pending = await notify(db, {
      workspaceId: wsJ,
      trigger: "chat_message",
      prospectId: cafe.prospectId,
      groupKey: "chat:quiet",
      title: "Café Müller schreibt im Chat",
      body: "Spät noch",
      url: `/kunden/${cafe.prospectId}`,
    });
    expect(pending!.channels).toEqual([]);
    const [row] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, pending!.id));
    expect(row).toMatchObject({ channels: [], suppressed: "quiet_hours" });
  });

  it("ignores the owner's own visits", async () => {
    const before = await scoreOf(wsJ, cafe.prospectId);
    const count = (await notificationsOf(wsJ)).length;
    const own = await visit(wsJ, cafe.slug, true);
    await recordVisitorTyping(db, { workspaceId: wsJ, body: { token: own, length: 40 } });
    expect((await scoreOf(wsJ, cafe.prospectId))?.score).toBe(before?.score);
    expect(await notificationsOf(wsJ)).toHaveLength(count);
    expect(pushes).not.toHaveBeenCalled();
  });

  it("keeps scores and notifications inside the workspace", async () => {
    await withTenant(db, { userId: kai.id, workspaceId: wsK }, async (tx) => {
      expect(await tx.select().from(schema.intentScores)).toEqual([]);
      expect(await tx.select().from(schema.notifications)).toEqual([]);
      expect(await tx.select().from(schema.pushSubscriptions)).toEqual([]);
    });
  });
});
