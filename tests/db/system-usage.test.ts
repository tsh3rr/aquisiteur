import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { publishExpose } from "@/server/exposes/publish";
import { isPlatformAdmin, platformUsage, workspaceUsage } from "@/server/system-usage";
import { startVisit } from "@/server/tracking/visits";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** Settings → System (§5a): usage figures against limits. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });
const sven = { id: "user-sven", email: "sven@s.test", name: "Sven" };
const olga = { id: "user-olga", email: "olga@s.test", name: "Olga" };
let ws = "";

beforeAll(async () => {
  await db.insert(schema.users).values([sven, olga]);
  const created = await createWorkspace(db, {
    userId: sven.id,
    name: "Agentur S",
    slug: "agentur-s",
  });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  const published = await withTenant(db, { userId: sven.id, workspaceId: ws }, (tx) =>
    publishExpose(
      tx,
      { workspaceId: ws, userId: sven.id, source: "api" },
      { document: minimalExpose("system-gmbh", "System GmbH"), assets: [] },
    ),
  );
  const headers = new Headers({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0" });
  for (const internal of [false, true]) {
    await startVisit(db, {
      workspaceId: ws,
      body: { slug: published.slug, viewport: { width: 390, height: 844 } },
      headers,
      internal,
    });
  }
});

afterAll(async () => {
  await close();
});

describe("system usage", () => {
  it("counts the workspace's exposés, customer visits and members", async () => {
    const usage = await withTenant(db, { userId: sven.id, workspaceId: ws }, (tx) =>
      workspaceUsage(tx, ws),
    );
    expect(usage.publishedExposes).toMatchObject({ used: 1, level: "unlimited" });
    // The owner's own visit does not count.
    expect(usage.monthlyVisits.used).toBe(1);
    expect(usage.members.used).toBe(1);
  });

  it("shows installation figures only to platform admins", async () => {
    expect(await isPlatformAdmin(db, olga)).toBe(false);
    await db.insert(schema.platformAdmins).values({ userId: olga.id });
    expect(await isPlatformAdmin(db, olga)).toBe(true);
    expect(await isPlatformAdmin(db, sven)).toBe(false);

    const platform = await platformUsage(db);
    expect(platform.plan).toBe("free");
    expect(platform.databaseBytes.used).toBeGreaterThan(0);
    expect(platform.databaseBytes.limit).toBe(500 * 1024 * 1024);
    expect(platform.metricsConfigured).toBe(false);
    expect(platform.requestsToday).toBeNull();
  });
});
