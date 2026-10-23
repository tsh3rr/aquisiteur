import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { getInfra } from "@/infra";
import { publishExpose, type PublishResult } from "@/server/exposes/publish";
import { exportProspect } from "@/server/data-export";
import { digestContent, digestSummary } from "@/server/notifications/digest";
import {
  createTask,
  listOpenTasks,
  runTaskReminders,
  setTaskDone,
  snoozeTask,
  updateTask,
} from "@/server/tasks";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** §7.8 Aufgaben & Wiedervorlagen: tenant-scoped tasks and the reminder job. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const tom = { id: "user-tom", email: "tom@t.test", name: "Tom" };
const uli = { id: "user-uli", email: "uli@u.test", name: "Uli" };
let actorT: Actor;
let actorU: Actor;
let cafe: PublishResult;
let gym: PublishResult;

const { push, email } = getInfra();
const pushes = vi.spyOn(push, "send");
const mails = vi.spyOn(email, "send");

const asTom = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(db, { userId: tom.id, workspaceId: actorT.workspaceId }, fn);

const form = (overrides: Partial<Parameters<typeof createTask>[3]> = {}) => ({
  title: "Freitag anrufen",
  note: null,
  dueDate: "2026-10-23",
  dueTime: "10:00",
  reminder: "at_due" as const,
  ...overrides,
});

async function task(id: string) {
  const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  return row!;
}

beforeAll(async () => {
  await db.insert(schema.users).values([tom, uli]);
  const t = await createWorkspace(db, { userId: tom.id, name: "Agentur T", slug: "agentur-t" });
  const u = await createWorkspace(db, { userId: uli.id, name: "Agentur U", slug: "agentur-u" });
  if (!t.ok || !u.ok) throw new Error("workspace setup failed");
  actorT = { userId: tom.id, role: "owner", workspaceId: t.workspace.id };
  actorU = { userId: uli.id, role: "owner", workspaceId: u.workspace.id };
  cafe = await withTenant(db, { userId: tom.id, workspaceId: actorT.workspaceId }, (tx) =>
    publishExpose(
      tx,
      { workspaceId: actorT.workspaceId, userId: tom.id, source: "api" },
      { document: minimalExpose("cafe-mueller", "Café Müller"), assets: [] },
    ),
  );
  gym = await withTenant(db, { userId: uli.id, workspaceId: actorU.workspaceId }, (tx) =>
    publishExpose(
      tx,
      { workspaceId: actorU.workspaceId, userId: uli.id, source: "api" },
      { document: minimalExpose("eisenwerk", "Eisenwerk"), assets: [] },
    ),
  );
  await db.insert(schema.pushSubscriptions).values({
    workspaceId: actorT.workspaceId,
    userId: tom.id,
    endpoint: "https://push.example/tom",
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

describe("tasks", () => {
  it("stores the reminder in the workspace's time zone", async () => {
    const id = await asTom((tx) =>
      createTask(tx, actorT, cafe.prospectId, form(), new Date("2026-10-20T10:00:00Z")),
    );
    const row = await task(id!);
    expect(row.remindAt?.toISOString()).toBe("2026-10-23T08:00:00.000Z");
    expect(row.remindedAt).toBeNull();
    expect(row.createdBy).toBe(tom.id);
  });

  it("never pings for a reminder that is already past when saving", async () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const id = await asTom((tx) => createTask(tx, actorT, cafe.prospectId, form(), now));
    expect((await task(id!)).remindedAt?.toISOString()).toBe(now.toISOString());
    await db.delete(schema.tasks).where(eq(schema.tasks.id, id!));
  });

  it("refuses a prospect of another workspace", async () => {
    expect(await asTom((tx) => createTask(tx, actorT, gym.prospectId, form()))).toBeNull();
    const foreign = await withTenant(
      db,
      { userId: uli.id, workspaceId: actorU.workspaceId },
      // A fixed clock: saved after its reminder time, the task would count as reminded already.
      (tx) =>
        createTask(
          tx,
          actorU,
          gym.prospectId,
          form({ title: "Uli ruft an" }),
          new Date("2026-10-20T10:00:00Z"),
        ),
    );
    expect(await asTom((tx) => setTaskDone(tx, actorT, foreign!, true))).toBe(false);
    expect(await asTom((tx) => snoozeTask(tx, actorT, foreign!, "2026-11-02"))).toBe(false);
    expect(
      (await asTom((tx) => listOpenTasks(tx, actorT.workspaceId))).map((t) => t.title),
    ).toEqual(["Freitag anrufen"]);
  });

  it("re-arms the reminder when the task moves", async () => {
    const [open] = await asTom((tx) => listOpenTasks(tx, actorT.workspaceId));
    await db
      .update(schema.tasks)
      .set({ remindedAt: new Date("2026-10-23T08:05:00Z") })
      .where(eq(schema.tasks.id, open!.id));
    await asTom((tx) =>
      snoozeTask(tx, actorT, open!.id, "2026-10-26", new Date("2026-10-23T09:00:00Z")),
    );
    const row = await task(open!.id);
    expect(row.dueDate).toBe("2026-10-26");
    expect(row.dueTime).toBe("10:00");
    // Winter time from 25 October: 10:00 Berlin is 09:00 UTC.
    expect(row.remindAt?.toISOString()).toBe("2026-10-26T09:00:00.000Z");
    expect(row.remindedAt).toBeNull();
  });

  it("lists what is due by a day, earliest first", async () => {
    await asTom((tx) =>
      createTask(
        tx,
        actorT,
        cafe.prospectId,
        form({ title: "Mockup schicken", dueDate: "2026-10-26", dueTime: null }),
        new Date("2026-10-20T10:00:00Z"),
      ),
    );
    const due = await asTom((tx) => listOpenTasks(tx, actorT.workspaceId, { until: "2026-10-26" }));
    expect(due.map((t) => [t.title, t.companyName])).toEqual([
      ["Freitag anrufen", "Café Müller"],
      ["Mockup schicken", "Café Müller"],
    ]);
    expect(
      await asTom((tx) => listOpenTasks(tx, actorT.workspaceId, { until: "2026-10-25" })),
    ).toEqual([]);
  });
});

describe("reminder job", () => {
  it("sends each due reminder once, by push and e-mail without a rule, to the task", async () => {
    const at = new Date("2026-10-26T09:01:00Z");
    // Uli's workspace has a due reminder too; it must not reach Tom.
    const result = await runTaskReminders(db, at);
    expect(result).toEqual({ due: 3, sent: 3 });
    const mine = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.workspaceId, actorT.workspaceId),
          eq(schema.notifications.trigger, "task_due"),
        ),
      );
    expect(mine.map((row) => row.title).sort()).toEqual([
      "Café Müller · Freitag anrufen",
      "Café Müller · Mockup schicken",
    ]);
    for (const row of mine) {
      expect(row.url).toMatch(new RegExp(`^/kunden/${cafe.prospectId}#aufgabe-`));
      expect(row.channels).toEqual(["push", "email"]);
    }
    expect(pushes).toHaveBeenCalledTimes(2);
    expect(mails.mock.calls.map(([mail]) => mail.to).sort()).toEqual([
      "tom@t.test",
      "tom@t.test",
      "uli@u.test",
    ]);

    pushes.mockClear();
    expect(await runTaskReminders(db, at)).toEqual({ due: 0, sent: 0 });
    expect(pushes).not.toHaveBeenCalled();
  });

  it("follows a task_due rule: its channels, or nothing when it is switched off", async () => {
    const id = await asTom((tx) =>
      createTask(
        tx,
        actorT,
        cafe.prospectId,
        form({ title: "Angebot nachfassen", dueDate: "2026-10-27" }),
        new Date("2026-10-26T10:00:00Z"),
      ),
    );
    const [rule] = await db
      .insert(schema.notificationRules)
      .values({ workspaceId: actorT.workspaceId, trigger: "task_due", channels: ["push"] })
      .returning();
    expect(await runTaskReminders(db, new Date("2026-10-27T09:30:00Z"))).toEqual({
      due: 1,
      sent: 1,
    });
    expect(pushes).toHaveBeenCalledTimes(1);
    expect(mails).not.toHaveBeenCalled();

    await asTom((tx) =>
      updateTask(tx, actorT, id!, form({ dueDate: "2026-10-28" }), new Date("2026-10-27T10:00Z")),
    );
    await db
      .update(schema.notificationRules)
      .set({ enabled: false })
      .where(eq(schema.notificationRules.id, rule!.id));
    pushes.mockClear();
    expect(await runTaskReminders(db, new Date("2026-10-28T09:30:00Z"))).toEqual({
      due: 1,
      sent: 0,
    });
    expect(pushes).not.toHaveBeenCalled();
  });

  it("skips done tasks", async () => {
    const id = await asTom((tx) =>
      createTask(
        tx,
        actorT,
        cafe.prospectId,
        form({ title: "Erledigt", dueDate: "2026-10-29" }),
        new Date("2026-10-28T10:00:00Z"),
      ),
    );
    await asTom((tx) => setTaskDone(tx, actorT, id!, true));
    expect(await runTaskReminders(db, new Date("2026-10-29T12:00:00Z"))).toEqual({
      due: 0,
      sent: 0,
    });
  });

  it("stops follow-ups for a prospect that opted out", async () => {
    const id = await asTom((tx) =>
      createTask(
        tx,
        actorT,
        cafe.prospectId,
        form({ title: "Nach Opt-out", dueDate: "2026-10-30" }),
        new Date("2026-10-28T10:00:00Z"),
      ),
    );
    await db
      .update(schema.prospects)
      .set({ doNotContactAt: new Date("2026-10-29T10:00:00Z") })
      .where(eq(schema.prospects.id, cafe.prospectId));
    expect(await runTaskReminders(db, new Date("2026-10-30T12:00:00Z"))).toEqual({
      due: 0,
      sent: 0,
    });
    expect(
      await asTom((tx) => listOpenTasks(tx, actorT.workspaceId, { until: "2026-10-30" })),
    ).toEqual([]);
    // Still listed in full, e.g. on the customer page.
    expect(
      (await asTom((tx) => listOpenTasks(tx, actorT.workspaceId))).map((t) => t.title),
    ).toContain("Nach Opt-out");
    const content = await digestContent(db, actorT.workspaceId, new Date("2026-10-30T07:00:00Z"));
    expect(content.dueTasks).toBe(0);
    await db.delete(schema.tasks).where(eq(schema.tasks.id, id!));
    await db
      .update(schema.prospects)
      .set({ doNotContactAt: null })
      .where(eq(schema.prospects.id, cafe.prospectId));
  });

  it("exports tasks with the prospect", async () => {
    const data = await asTom((tx) => exportProspect(tx, actorT.workspaceId, cafe.prospectId));
    expect((data?.tables.tasks ?? []).length).toBeGreaterThan(0);
  });

  it("counts open tasks due today in the digest", async () => {
    const content = await digestContent(
      db,
      actorT.workspaceId,
      new Date("2026-10-28T07:00:00Z"),
      "Europe/Berlin",
    );
    expect(content.dueTasks).toBe(3);
    expect(digestSummary(content)).toBe("Fällig oder überfällig: 3 Aufgaben.");
  });
});
