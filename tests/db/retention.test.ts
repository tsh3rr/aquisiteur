import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { CONSENT_NOTICE_VERSION } from "@/domain/tracking/consent";
import { exportProspect, exportWorkspaceStream } from "@/server/data-export";
import { publishExpose, type PublishResult } from "@/server/exposes/publish";
import { deleteProspect, setDoNotContact } from "@/server/prospects/mutations";
import { runRetention } from "@/server/retention";
import { appendReplayChunk, recordConsent } from "@/server/tracking/replay";
import { startVisit } from "@/server/tracking/visits";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** Phase 6: retention (§9), data subject export and deletion (§9, §9a). */

const storageDir = mkdtempSync(join(tmpdir(), "aq-retention-"));
process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
process.env.LOCAL_STORAGE_DIR = storageDir;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const paula = { id: "user-paula", email: "paula@p.test", name: "Paula" };
let ws = "";
let blocked: PublishResult;
let kept: PublishResult;
const DAY = 24 * 3600 * 1000;

const asPaula = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(db, { userId: paula.id, workspaceId: ws }, fn);
const actor = () => ({ userId: paula.id, workspaceId: ws, role: "owner" as const });

async function visitWithRecording(expose: PublishResult) {
  const started = await startVisit(db, {
    workspaceId: ws,
    body: { slug: expose.slug, viewport: { width: 390, height: 844 } },
    headers: new Headers({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0" }),
    internal: false,
  });
  if (!("token" in started)) throw new Error("visit failed");
  await db.update(schema.workspaceSettings).set({ replay: { enabled: true } });
  await recordConsent(db, {
    workspaceId: ws,
    body: { token: started.token, decision: "given", version: CONSENT_NOTICE_VERSION },
  });
  const body = { token: started.token, events: [{ type: 4, timestamp: Date.now() }] };
  await appendReplayChunk(db, {
    workspaceId: ws,
    body,
    rawBytes: JSON.stringify(body).length,
  });
  const [visit] = await db
    .select({ id: schema.visits.id })
    .from(schema.visits)
    .where(and(eq(schema.visits.workspaceId, ws), eq(schema.visits.prospectId, expose.prospectId)));
  return visit!.id;
}

async function count(
  table: typeof schema.visits | typeof schema.sessionReplays,
  prospectId: string,
) {
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.workspaceId, ws), eq(table.prospectId, prospectId)));
  return rows.length;
}

beforeAll(async () => {
  await db.insert(schema.users).values(paula);
  const created = await createWorkspace(db, {
    userId: paula.id,
    name: "Agentur P",
    slug: "agentur-p",
  });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  const publish = (key: string, name: string) =>
    asPaula((tx) =>
      publishExpose(
        tx,
        { workspaceId: ws, userId: paula.id, source: "api" },
        { document: minimalExpose(key, name), assets: [] },
      ),
    );
  blocked = await publish("baeckerei-korn", "Bäckerei Korn");
  kept = await publish("optik-klar", "Optik Klar");
});

afterAll(async () => {
  await close();
  rmSync(storageDir, { recursive: true, force: true });
});

describe("retention", () => {
  it("keeps only the block marker some days after an opt-out", async () => {
    const visitId = await visitWithRecording(blocked);
    const [thread] = await db
      .insert(schema.chatThreads)
      .values({
        workspaceId: ws,
        prospectId: blocked.prospectId,
        exposeId: blocked.exposeId,
        visitId,
      })
      .returning({ id: schema.chatThreads.id });
    const [replay] = await db
      .select({ id: schema.sessionReplays.id })
      .from(schema.sessionReplays)
      .where(eq(schema.sessionReplays.prospectId, blocked.prospectId));
    const folder = join(storageDir, ws, "replays", replay!.id);
    expect(existsSync(folder)).toBe(true);

    await asPaula((tx) => setDoNotContact(tx, actor(), blocked.prospectId, true));
    // Within the period nothing is deleted.
    expect((await runRetention(db, new Date(), ws)).prospectsPurged).toBe(0);
    expect(await count(schema.visits, blocked.prospectId)).toBe(1);

    const later = new Date(Date.now() + 31 * DAY);
    const result = await runRetention(db, later, ws);
    expect(result.prospectsPurged).toBe(1);
    expect(await count(schema.visits, blocked.prospectId)).toBe(0);
    expect(await count(schema.sessionReplays, blocked.prospectId)).toBe(0);
    expect(existsSync(folder)).toBe(false);

    const [prospect] = await db
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.id, blocked.prospectId));
    expect(prospect!.doNotContactAt).not.toBeNull();
    expect(prospect!.trackingPurgedAt).not.toBeNull();
    // The chat stays as correspondence, unlinked from the deleted visit.
    const [chat] = await db
      .select({ visitId: schema.chatThreads.visitId })
      .from(schema.chatThreads)
      .where(eq(schema.chatThreads.id, thread!.id));
    expect(chat).toEqual({ visitId: null });
    // Purged once only.
    expect((await runRetention(db, later, ws)).prospectsPurged).toBe(0);
  });

  it("deletes raw events after the configured period, not the visits", async () => {
    await visitWithRecording(kept);
    const [visit] = await db
      .select({ id: schema.visits.id, exposeId: schema.visits.exposeId })
      .from(schema.visits)
      .where(eq(schema.visits.prospectId, kept.prospectId));
    await db.insert(schema.events).values({
      workspaceId: ws,
      visitId: visit!.id,
      exposeId: visit!.exposeId,
      type: "scroll_depth",
      occurredAt: new Date(),
    });
    await db
      .update(schema.workspaceSettings)
      .set({ retention: { eventsDays: 30, replaysDays: 90, optOutTrackingDays: 30 } })
      .where(eq(schema.workspaceSettings.workspaceId, ws));
    const result = await runRetention(db, new Date(Date.now() + 31 * DAY), ws);
    expect(result.eventsDeleted).toBeGreaterThanOrEqual(1);
    const events = await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.visitId, visit!.id));
    expect(events).toHaveLength(0);
    expect(await count(schema.visits, kept.prospectId)).toBe(1);
  });

  it("removes stale rate-limit counters and expired sign-in links", async () => {
    await db.insert(schema.rateLimits).values({
      id: "rl-old",
      key: "1.2.3.4|/sign-in",
      count: 3,
      lastRequest: Date.now() - 2 * DAY,
    });
    const result = await runRetention(db);
    expect(result.authRowsDeleted).toBeGreaterThanOrEqual(1);
    const left = await db
      .select()
      .from(schema.rateLimits)
      .where(eq(schema.rateLimits.id, "rl-old"));
    expect(left).toHaveLength(0);
  });
});

describe("export and deletion", () => {
  it("exports one prospect with its visits, chats and audit trail", async () => {
    const data = await asPaula((tx) => exportProspect(tx, ws, kept.prospectId));
    expect(data?.tables.prospects?.[0]?.companyName).toBe("Optik Klar");
    expect(data?.tables.visits).toHaveLength(1);
    expect(data?.tables.exposes).toHaveLength(1);
    expect(data?.tables.expose_versions?.length).toBeGreaterThan(0);
    expect(data?.files).toHaveLength(1);
    // Another prospect's data never shows up.
    expect(JSON.stringify(data)).not.toContain("Bäckerei Korn");
  });

  it("exports the workspace as valid JSON without credentials", async () => {
    await db.insert(schema.apiTokens).values({
      workspaceId: ws,
      name: "CLI",
      prefix: "aq_test",
      tokenHash: "secret-hash-value",
    });
    const stream = exportWorkspaceStream(
      (fn) => withTenant(db, { userId: paula.id, workspaceId: ws }, fn),
      ws,
    );
    const text = await new Response(stream).text();
    const parsed = JSON.parse(text) as { tables: Record<string, unknown[]> };
    expect(parsed.tables.prospects).toHaveLength(2);
    expect(parsed.tables.api_tokens).toHaveLength(1);
    expect(text).not.toContain("secret-hash-value");
  });

  it("deletes a prospect together with its recording files", async () => {
    const [replay] = await db
      .select({ id: schema.sessionReplays.id })
      .from(schema.sessionReplays)
      .where(eq(schema.sessionReplays.prospectId, kept.prospectId));
    const folder = join(storageDir, ws, "replays", replay!.id);
    expect(existsSync(folder)).toBe(true);
    await asPaula((tx) => deleteProspect(tx, actor(), kept.prospectId));
    expect(existsSync(folder)).toBe(false);
    expect(await count(schema.visits, kept.prospectId)).toBe(0);
  });
});
