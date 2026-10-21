import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { FOLLOW_UP_TASK_TITLE } from "@/domain/letters/follow-up";
import { getInfra } from "@/infra";
import { publishExpose, type PublishResult } from "@/server/exposes/publish";
import { runAutoFollowUps } from "@/server/letters/follow-up";
import { advanceLetters, createLetters, deleteDraftLetters } from "@/server/letters/manage";
import { runTaskReminders } from "@/server/tasks";
import { startVisit } from "@/server/tracking/visits";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** §7.9 automatic follow-up letters, prepared by the hourly job. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const ida = { id: "user-ida", email: "ida@i.test", name: "Ida" };
const ole = { id: "user-ole", email: "ole@o.test", name: "Ole" };
const DAY = 24 * 3600 * 1000;
const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

let wsI = "";
let wsO = "";
let actorI: Actor;
let actorO: Actor;
let quiet: PublishResult;
let reader: PublishResult;
let blocked: PublishResult;
let other: PublishResult;

const { push } = getInfra();
vi.spyOn(push, "send");

const asIda = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: ida.id, workspaceId: wsI }, fn);

async function postFirstLetter(actor: Actor, prospectId: string, postedAt: Date) {
  const run = (fn: (tx: Transaction) => Promise<unknown>) =>
    withTenant(db, { userId: actor.userId, workspaceId: actor.workspaceId }, fn);
  let id = "";
  await run(async (tx) => {
    const { created } = await createLetters(tx, actor, {
      prospectIds: [prospectId],
      kind: "initial",
    });
    id = created[0]!;
    await advanceLetters(tx, actor, [id], "posted", postedAt);
  });
  return id;
}

const followUpsOf = (workspaceId: string, prospectId: string) =>
  db
    .select()
    .from(schema.letters)
    .where(
      and(
        eq(schema.letters.workspaceId, workspaceId),
        eq(schema.letters.prospectId, prospectId),
        eq(schema.letters.kind, "follow_up"),
      ),
    );

const tasksOf = (prospectId: string) =>
  db.select().from(schema.tasks).where(eq(schema.tasks.prospectId, prospectId));

beforeAll(async () => {
  await db.insert(schema.users).values([ida, ole]);
  const i = await createWorkspace(db, {
    userId: ida.id,
    name: "Agentur I",
    slug: "agentur-folgebrief-i",
  });
  const o = await createWorkspace(db, {
    userId: ole.id,
    name: "Agentur O",
    slug: "agentur-folgebrief-o",
  });
  if (!i.ok || !o.ok) throw new Error("workspace setup failed");
  wsI = i.workspace.id;
  wsO = o.workspace.id;
  actorI = { userId: ida.id, role: "owner", workspaceId: wsI };
  actorO = { userId: ole.id, role: "owner", workspaceId: wsO };
  const publish = (actor: Actor, key: string, company: string) =>
    withTenant(db, { userId: actor.userId, workspaceId: actor.workspaceId }, (tx) =>
      publishExpose(
        tx,
        { workspaceId: actor.workspaceId, userId: actor.userId, source: "api" },
        { document: minimalExpose(key, company), assets: [] },
      ),
    );
  quiet = await publish(actorI, "cafe-still", "Café Still");
  reader = await publish(actorI, "baeckerei-leser", "Bäckerei Leser");
  blocked = await publish(actorI, "friseur-nein", "Friseur Nein");
  other = await publish(actorO, "gym-ole", "Gym Ole");
  // Ole's workspace waits longer and gets a different follow-up text.
  const [settings] = await db
    .select({ letter: schema.workspaceSettings.letter })
    .from(schema.workspaceSettings)
    .where(eq(schema.workspaceSettings.workspaceId, wsO));
  await db
    .update(schema.workspaceSettings)
    .set({
      letter: {
        ...(settings!.letter as object),
        followUp: { enabled: true, afterDays: 21, subject: "Erinnerung für {{firma}}" },
      },
    })
    .where(eq(schema.workspaceSettings.workspaceId, wsO));
});

afterAll(async () => {
  // The reminder job looks across workspaces; leave nothing due for other test files.
  await db
    .update(schema.tasks)
    .set({ doneAt: new Date() })
    .where(inArray(schema.tasks.workspaceId, [wsI, wsO]));
  await close();
});

describe("automatic follow-ups", () => {
  const now = new Date();
  let quietLetter = "";

  beforeAll(async () => {
    quietLetter = await postFirstLetter(
      actorI,
      quiet.prospectId,
      new Date(now.getTime() - 15 * DAY),
    );
    await postFirstLetter(actorI, reader.prospectId, new Date(now.getTime() - 15 * DAY));
    await postFirstLetter(actorI, blocked.prospectId, new Date(now.getTime() - 15 * DAY));
    await postFirstLetter(actorO, other.prospectId, new Date(now.getTime() - 15 * DAY));
    // Bäckerei Leser opened the exposé after the letter arrived.
    const started = await startVisit(db, {
      workspaceId: wsI,
      body: { slug: reader.slug, viewport: { width: 390, height: 844 } },
      headers: new Headers({ "user-agent": PHONE }),
      internal: false,
    });
    if (!("token" in started)) throw new Error("visit failed");
    await db
      .update(schema.visits)
      .set({ startedAt: new Date(now.getTime() - 10 * DAY), confirmedAt: new Date() })
      .where(eq(schema.visits.prospectId, reader.prospectId));
    await db
      .update(schema.prospects)
      .set({ doNotContactAt: new Date() })
      .where(eq(schema.prospects.id, blocked.prospectId));
  });

  it("prepares a draft with its own code and text and a task that reminds now", async () => {
    // Other test files share the database, so only this workspace's outcome is counted.
    expect((await runAutoFollowUps(db, now)).prepared).toBe(1);
    const [followUp] = await followUpsOf(wsI, quiet.prospectId);
    expect(followUp).toMatchObject({
      status: "draft",
      subject: "Noch einmal kurz: Ideen für {{firma}}",
    });
    const [first] = await asIda((tx) =>
      tx.select().from(schema.letters).where(eq(schema.letters.id, quietLetter)),
    );
    expect(followUp!.touchpointId).not.toBe(first!.touchpointId);
    expect(first!.followUpAt).toEqual(now);
    const [task] = await tasksOf(quiet.prospectId);
    expect(task).toMatchObject({ title: FOLLOW_UP_TASK_TITLE, remindAt: now, remindedAt: null });
    expect(task!.note).toContain("Entwurf");
    await runTaskReminders(db, now);
    const [reminded] = await tasksOf(quiet.prospectId);
    expect(reminded!.remindedAt).toEqual(now);
  });

  it("leaves out prospects who read the exposé or said „Kein Interesse“", async () => {
    expect(await followUpsOf(wsI, reader.prospectId)).toHaveLength(0);
    expect(await followUpsOf(wsI, blocked.prospectId)).toHaveLength(0);
    expect(await tasksOf(blocked.prospectId)).toHaveLength(0);
  });

  it("honours each workspace's own waiting time", async () => {
    expect(await followUpsOf(wsO, other.prospectId)).toHaveLength(0);
    await runAutoFollowUps(db, new Date(now.getTime() + 7 * DAY));
    const [followUp] = await followUpsOf(wsO, other.prospectId);
    expect(followUp!.subject).toBe("Erinnerung für {{firma}}");
    expect(followUp!.createdByUserId).toBe(ole.id);
  });

  it("runs once per first letter, even after the draft was deleted", async () => {
    const [followUp] = await followUpsOf(wsI, quiet.prospectId);
    await asIda((tx) => deleteDraftLetters(tx, actorI, [followUp!.id]));
    await runAutoFollowUps(db, new Date(now.getTime() + DAY));
    expect(await followUpsOf(wsI, quiet.prospectId)).toHaveLength(0);
    expect(await tasksOf(quiet.prospectId)).toHaveLength(1);
  });

  it("does nothing while the rule is off", async () => {
    const late = await withTenant(db, { userId: ida.id, workspaceId: wsI }, (tx) =>
      publishExpose(
        tx,
        { workspaceId: wsI, userId: ida.id, source: "api" },
        { document: minimalExpose("laden-spaet", "Laden Spät"), assets: [] },
      ),
    );
    await postFirstLetter(actorI, late.prospectId, new Date(now.getTime() - 20 * DAY));
    const [settings] = await db
      .select({ letter: schema.workspaceSettings.letter })
      .from(schema.workspaceSettings)
      .where(eq(schema.workspaceSettings.workspaceId, wsI));
    await db
      .update(schema.workspaceSettings)
      .set({ letter: { ...(settings!.letter as object), followUp: { enabled: false } } })
      .where(eq(schema.workspaceSettings.workspaceId, wsI));
    await runAutoFollowUps(db, now);
    expect(await followUpsOf(wsI, late.prospectId)).toHaveLength(0);
  });
});
