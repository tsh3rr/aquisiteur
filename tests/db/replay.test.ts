import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { REPLAY_NOTICE_VERSION } from "@/domain/tracking/replay";
import { publishExpose, type PublishResult } from "@/server/exposes/publish";
import {
  appendReplayChunk,
  listReplays,
  loadReplayEvents,
  purgeExpiredReplays,
  recordConsent,
} from "@/server/tracking/replay";
import { startVisit } from "@/server/tracking/visits";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** Phase 5: consent and session replay (§6.3, §9). */

const storageDir = mkdtempSync(join(tmpdir(), "aq-replay-"));
process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
process.env.LOCAL_STORAGE_DIR = storageDir;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const rita = { id: "user-rita", email: "rita@r.test", name: "Rita" };
const otto = { id: "user-otto", email: "otto@o.test", name: "Otto" };
let wsR = "";
let wsO = "";
let expose: PublishResult;

const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function visit() {
  const started = await startVisit(db, {
    workspaceId: wsR,
    body: { slug: expose.slug, viewport: { width: 390, height: 844 } },
    headers: new Headers({ "user-agent": PHONE }),
    internal: false,
  });
  if (!("token" in started)) throw new Error("visit failed");
  return started.token;
}

const consent = (token: string, decision: "given" | "denied" | "withdrawn") =>
  recordConsent(db, {
    workspaceId: wsR,
    body: { token, decision, version: REPLAY_NOTICE_VERSION },
  });

const chunk = (token: string, events: { type: number; timestamp: number }[]) => {
  const body = { token, events };
  return appendReplayChunk(db, {
    workspaceId: wsR,
    body,
    rawBytes: JSON.stringify(body).length,
  });
};

const asRita = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(db, { userId: rita.id, workspaceId: wsR }, fn);

beforeAll(async () => {
  await db.insert(schema.users).values([rita, otto]);
  const r = await createWorkspace(db, { userId: rita.id, name: "Agentur R", slug: "agentur-r" });
  const o = await createWorkspace(db, { userId: otto.id, name: "Agentur O", slug: "agentur-o" });
  if (!r.ok || !o.ok) throw new Error("workspace setup failed");
  wsR = r.workspace.id;
  wsO = o.workspace.id;
  expose = await asRita((tx) =>
    publishExpose(
      tx,
      { workspaceId: wsR, userId: rita.id, source: "api" },
      { document: minimalExpose("salon-schnitt", "Salon Schnitt"), assets: [] },
    ),
  );
});

afterAll(async () => {
  await close();
  rmSync(storageDir, { recursive: true, force: true });
});

describe("consent and session replay", () => {
  it("asks nobody while the owner has replay switched off", async () => {
    const token = await visit();
    expect(await consent(token, "given")).toBe("disabled");
    expect(await chunk(token, [{ type: 4, timestamp: 1 }])).toBe("forbidden");
  });

  it("records only after a yes, and only for that visit", async () => {
    await db
      .update(schema.workspaceSettings)
      .set({ replay: { enabled: true } })
      .where(eq(schema.workspaceSettings.workspaceId, wsR));
    const declined = await visit();
    expect(await consent(declined, "denied")).toBe("ok");
    expect(await chunk(declined, [{ type: 4, timestamp: 1 }])).toBe("forbidden");

    const token = await visit();
    expect(await chunk(token, [{ type: 4, timestamp: 1 }])).toBe("forbidden");
    expect(await consent(token, "given")).toBe("ok");
    const t0 = Date.now();
    expect(
      await chunk(token, [
        { type: 4, timestamp: t0 },
        { type: 2, timestamp: t0 + 10 },
      ]),
    ).toBe("ok");
    expect(await chunk(token, [{ type: 3, timestamp: t0 + 5_000 }])).toBe("ok");
    expect(await chunk("x".repeat(40), [{ type: 3, timestamp: t0 }])).toBe("invalid");

    const replays = await asRita((tx) => listReplays(tx, wsR, expose.prospectId));
    expect(replays).toHaveLength(1);
    expect(replays[0]!.durationMs).toBe(5_000);
    const loaded = await asRita((tx) => loadReplayEvents(tx, wsR, replays[0]!.id));
    expect(loaded?.events.map((event) => event.type)).toEqual([4, 2, 3]);

    // Proof of consent and the timeline events.
    const decisions = await db
      .select({ decision: schema.consents.decision, version: schema.consents.noticeVersion })
      .from(schema.consents)
      .where(eq(schema.consents.workspaceId, wsR));
    expect(decisions.map((row) => row.decision).sort()).toEqual(["denied", "given"]);
    expect(decisions.every((row) => row.version === REPLAY_NOTICE_VERSION)).toBe(true);
    const types = await db
      .select({ type: schema.events.type })
      .from(schema.events)
      .where(and(eq(schema.events.workspaceId, wsR), eq(schema.events.type, "consent_given")));
    expect(types).toHaveLength(1);

    // Another workspace sees nothing of it.
    const foreign = await withTenant(db, { userId: otto.id, workspaceId: wsO }, (tx) =>
      loadReplayEvents(tx, wsO, replays[0]!.id),
    );
    expect(foreign).toBeNull();

    // Withdrawal deletes the recording at once and stops further uploads.
    expect(await consent(token, "withdrawn")).toBe("ok");
    expect(await asRita((tx) => listReplays(tx, wsR, expose.prospectId))).toEqual([]);
    expect(await chunk(token, [{ type: 3, timestamp: t0 + 6_000 }])).toBe("forbidden");
  });

  it("deletes recordings after the retention period", async () => {
    const token = await visit();
    await consent(token, "given");
    expect(await chunk(token, [{ type: 4, timestamp: Date.now() }])).toBe("ok");
    // Scoped to this workspace: other test files keep their recordings.
    expect(await purgeExpiredReplays(db, new Date(), wsR)).toBe(0);
    const later = new Date(Date.now() + 91 * 24 * 3600 * 1000);
    expect(await purgeExpiredReplays(db, later, wsR)).toBe(1);
    expect(await asRita((tx) => listReplays(tx, wsR, expose.prospectId))).toEqual([]);
  });
});
