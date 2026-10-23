import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { EXPIRY_DAY_MS } from "@/domain/expose/expiry";
import { exposeExpiries, exposeExpiry } from "@/server/exposes/expiry";
import { loadPublicExpose } from "@/server/exposes/load";
import { publishExpose, type PublishResult } from "@/server/exposes/publish";
import { startVisit } from "@/server/tracking/visits";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** Exposé expiry (§7.3, ADR-0078): derived from the last activity, never stored. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const hanna = { id: "user-hanna", email: "hanna@h.test", name: "Hanna" };
let ws = "";
let cafe: PublishResult;
let other: PublishResult;
const settings = { enabled: true, afterDays: 60 };
const daysAgo = (days: number) => new Date(Date.now() - days * EXPIRY_DAY_MS);
const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function publish(key: string, company: string) {
  return withTenant(db, { userId: hanna.id, workspaceId: ws }, (tx) =>
    publishExpose(
      tx,
      { workspaceId: ws, userId: hanna.id, source: "api" },
      { document: minimalExpose(key, company), assets: [] },
    ),
  );
}

async function age(result: PublishResult, days: number) {
  await db
    .update(schema.exposeVersions)
    .set({ createdAt: daysAgo(days) })
    .where(eq(schema.exposeVersions.id, result.versionId));
}

async function visit(result: PublishResult) {
  const started = await startVisit(db, {
    workspaceId: ws,
    body: { slug: result.slug, viewport: { width: 390, height: 844 } },
    headers: new Headers({ "user-agent": PHONE }),
    internal: false,
  });
  if (!("token" in started)) throw new Error(`start failed: ${started.error}`);
  const [row] = await db
    .select()
    .from(schema.visits)
    .where(eq(schema.visits.exposeId, result.exposeId))
    .orderBy(desc(schema.visits.startedAt))
    .limit(1);
  return row!;
}

beforeAll(async () => {
  await db.insert(schema.users).values(hanna);
  const created = await createWorkspace(db, {
    userId: hanna.id,
    name: "Agentur H",
    slug: "agentur-h",
  });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  cafe = await publish("cafe-ablauf", "Café Ablauf");
  other = await publish("baeckerei-frisch", "Bäckerei Frisch");
});

afterAll(async () => {
  await close();
});

describe("exposé expiry", () => {
  it("a fresh exposé is current, with the expiry date set from its version", async () => {
    const expiry = await exposeExpiry(db, ws, cafe.exposeId, settings);
    expect(expiry.expired).toBe(false);
    expect(expiry.expiresAt!.getTime() - expiry.lastActivityAt.getTime()).toBe(60 * EXPIRY_DAY_MS);
  });

  it("expires after the set days without activity; the public page knows it", async () => {
    await age(cafe, 61);
    expect((await exposeExpiry(db, ws, cafe.exposeId, settings)).expired).toBe(true);
    expect(
      (await exposeExpiry(db, ws, cafe.exposeId, { ...settings, afterDays: 90 })).expired,
    ).toBe(false);
    expect(
      (await exposeExpiry(db, ws, cafe.exposeId, { ...settings, enabled: false })).expired,
    ).toBe(false);
    const page = await loadPublicExpose(db, ws, cafe.slug);
    expect(page?.expiry.expired).toBe(true);
  });

  it("a visit of the short page is recorded as such and does not bring the exposé back", async () => {
    const row = await visit(cafe);
    expect(row.onExpiredPage).toBe(true);
    expect((await exposeExpiry(db, ws, cafe.exposeId, settings)).expired).toBe(true);
  });

  it("a posted letter makes it current again", async () => {
    const [touchpoint] = await db
      .select()
      .from(schema.touchpoints)
      .where(
        and(eq(schema.touchpoints.workspaceId, ws), eq(schema.touchpoints.exposeId, cafe.exposeId)),
      );
    const [letter] = await db
      .insert(schema.letters)
      .values({
        workspaceId: ws,
        prospectId: cafe.prospectId,
        touchpointId: touchpoint!.id,
        options: { color: false, duplex: false, shipping: "standard", envelope: "DL", inserts: [] },
        subject: "Brief",
        body: "Text",
        status: "posted",
        postedAt: daysAgo(5),
      })
      .returning();
    expect((await exposeExpiry(db, ws, cafe.exposeId, settings)).expired).toBe(false);
    await db.delete(schema.letters).where(eq(schema.letters.id, letter!.id));
  });

  it("„Wieder voll anzeigen“ restarts the clock, and a full-page visit then keeps it current", async () => {
    await db
      .update(schema.exposes)
      .set({ expiryResetAt: daysAgo(1) })
      .where(eq(schema.exposes.id, cafe.exposeId));
    expect((await exposeExpiry(db, ws, cafe.exposeId, settings)).expired).toBe(false);
    const row = await visit(cafe);
    expect(row.onExpiredPage).toBe(false);
  });

  it("evaluates every exposé of the workspace in one go", async () => {
    await age(other, 70);
    const all = await exposeExpiries(db, ws, settings);
    expect(all.get(cafe.exposeId)?.expired).toBe(false);
    expect(all.get(other.exposeId)?.expired).toBe(true);
  });
});
