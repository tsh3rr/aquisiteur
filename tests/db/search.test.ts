import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import { createCampaign } from "@/server/campaigns";
import { publishExpose } from "@/server/exposes/publish";
import { searchWorkspace } from "@/server/search";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** Global search (§7.8): finds the workspace's records, never another's. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const sue = { id: "user-search-sue", email: "sue@s.test", name: "Sue" };
const tom = { id: "user-search-tom", email: "tom@t.test", name: "Tom" };
let wsS = "";
let wsT = "";
let cafeProspect = "";
let cafeExpose = "";

const asSue = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: sue.id, workspaceId: wsS }, fn);
const asTom = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: tom.id, workspaceId: wsT }, fn);

beforeAll(async () => {
  await db.insert(schema.users).values([sue, tom]);
  const s = await createWorkspace(db, { userId: sue.id, name: "Agentur S", slug: "agentur-s" });
  const t = await createWorkspace(db, { userId: tom.id, name: "Agentur T", slug: "agentur-t" });
  if (!s.ok || !t.ok) throw new Error("workspace setup failed");
  wsS = s.workspace.id;
  wsT = t.workspace.id;

  const cafe = await asSue((tx) =>
    publishExpose(
      tx,
      { workspaceId: wsS, userId: sue.id, source: "api" },
      { document: minimalExpose("cafe-mueller", "Café Müller"), assets: [] },
    ),
  );
  cafeProspect = cafe.prospectId;
  cafeExpose = cafe.exposeId;
  await db
    .update(schema.prospects)
    .set({ city: "Leipzig" })
    .where(eq(schema.prospects.id, cafeProspect));
  await asSue((tx) =>
    createCampaign(
      tx,
      { userId: sue.id, role: "owner", workspaceId: wsS },
      { name: "Cafés Leipzig 50% Rabatt", description: null },
    ),
  );
  // Tom's workspace has a lookalike that Sue must never see.
  await asTom((tx) =>
    publishExpose(
      tx,
      { workspaceId: wsT, userId: tom.id, source: "api" },
      { document: minimalExpose("cafe-mueller", "Café Müller Tom"), assets: [] },
    ),
  );
});

afterAll(async () => {
  await close();
});

describe("searchWorkspace", () => {
  it("finds prospect, exposé and campaign in any umlaut spelling", async () => {
    for (const query of ["Müller", "mueller", "muller", "MÜLL"]) {
      const hits = await asSue((tx) => searchWorkspace(tx, wsS, query));
      expect(
        hits.map((hit) => hit.kind),
        query,
      ).toEqual(["prospect", "expose"]);
      expect(hits[0]).toMatchObject({
        id: cafeProspect,
        title: "Café Müller",
        detail: "Leipzig · Entwurf",
        href: `/kunden/${cafeProspect}`,
      });
      expect(hits[1]).toMatchObject({ id: cafeExpose, href: `/exposes/${cafeExpose}` });
    }
    const campaigns = await asSue((tx) => searchWorkspace(tx, wsS, "cafe leipzig"));
    expect(campaigns.map((hit) => hit.kind)).toEqual(["prospect", "campaign"]);
  });

  it("finds a prospect by its contact person", async () => {
    const hits = await asSue((tx) => searchWorkspace(tx, wsS, "muster"));
    expect(hits.find((hit) => hit.kind === "prospect")?.id).toBe(cafeProspect);
  });

  it("treats LIKE wildcards literally", async () => {
    expect(await asSue((tx) => searchWorkspace(tx, wsS, "_"))).toEqual([]);
    for (const query of ["%", "50%"]) {
      const hits = await asSue((tx) => searchWorkspace(tx, wsS, query));
      expect(
        hits.map((hit) => hit.kind),
        query,
      ).toEqual(["campaign"]);
    }
  });

  it("stays inside the workspace, even when asked for another", async () => {
    const own = await asSue((tx) => searchWorkspace(tx, wsS, "tom"));
    expect(own).toEqual([]);
    // RLS fences a forged workspace id too.
    const forged = await asSue((tx) => searchWorkspace(tx, wsT, "müller"));
    expect(forged).toEqual([]);
    const toms = await asTom((tx) => searchWorkspace(tx, wsT, "müller"));
    expect(toms.map((hit) => hit.title)).toContain("Café Müller Tom");
  });
});
