import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { loadPublicExpose } from "@/server/exposes/load";
import { optOutByExposeSlug } from "@/server/exposes/opt-out";
import { PublishError, publishExpose, type PublishResult } from "@/server/exposes/publish";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** Publishing semantics (§7.2) and the scoping of public exposé reads. */

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const dora = { id: "user-dora", email: "dora@d.test", name: "Dora" };
const emil = { id: "user-emil", email: "emil@e.test", name: "Emil" };
let wsD = "";
let wsE = "";

function publish(userId: string, workspaceId: string, document: unknown, assets = []) {
  return withTenant(db, { userId, workspaceId }, (tx) =>
    publishExpose(tx, { workspaceId, userId, source: "api" }, { document, assets }),
  );
}

async function rejection(promise: Promise<unknown>): Promise<PublishError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PublishError) return error;
    throw error;
  }
  throw new Error("expected a PublishError");
}

let first: PublishResult;
let foreign: PublishResult;

beforeAll(async () => {
  await db.insert(schema.users).values([dora, emil]);
  const d = await createWorkspace(db, { userId: dora.id, name: "Agentur D", slug: "agentur-d" });
  const e = await createWorkspace(db, { userId: emil.id, name: "Agentur E", slug: "agentur-e" });
  if (!d.ok || !e.ok) throw new Error("workspace setup failed");
  wsD = d.workspace.id;
  wsE = e.workspace.id;
  first = await publish(dora.id, wsD, minimalExpose("baeckerei", "Bäckerei Korn"));
  foreign = await publish(emil.id, wsE, minimalExpose("baeckerei", "Bäckerei Korn"));
});

afterAll(async () => {
  await close();
});

describe("publishing", () => {
  it("creates prospect, exposé and version 1 on the first publish", () => {
    expect(first).toMatchObject({ version: 1, createdExpose: true });
    expect(first.slug).toMatch(/^baeckerei-[a-z0-9]{10}$/);
    expect(first.refCode).toMatch(/^[A-Z0-9]{4,5}$/);
  });

  it("adds a version and keeps slug, ref code and cockpit edits on republish", async () => {
    await db
      .update(schema.prospects)
      .set({ companyName: "Bäckerei Korn & Söhne" })
      .where(eq(schema.prospects.id, first.prospectId));
    const second = await publish(
      dora.id,
      wsD,
      minimalExpose("baeckerei", "Bäckerei Korn", "Neue Überschrift"),
    );
    expect(second).toMatchObject({
      exposeId: first.exposeId,
      prospectId: first.prospectId,
      slug: first.slug,
      refCode: first.refCode,
      version: 2,
      createdExpose: false,
    });
    const [prospect] = await db
      .select({ companyName: schema.prospects.companyName })
      .from(schema.prospects)
      .where(eq(schema.prospects.id, first.prospectId));
    expect(prospect?.companyName).toBe("Bäckerei Korn & Söhne");
    const versions = await db
      .select({ version: schema.exposeVersions.version })
      .from(schema.exposeVersions)
      .where(eq(schema.exposeVersions.exposeId, first.exposeId));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it("keeps the same prospect key apart per workspace", () => {
    expect(foreign.prospectId).not.toBe(first.prospectId);
    expect(foreign.exposeId).not.toBe(first.exposeId);
  });

  it("rejects invalid documents with readable paths", async () => {
    const error = await rejection(
      publish(dora.id, wsD, { ...minimalExpose("x", "X"), blocks: [] }),
    );
    expect(error.status).toBe(400);
    expect(error.issues.map((issue) => issue.path)).toContain("blocks");
  });

  it("does not let a workspace use another workspace's uploaded asset", async () => {
    const sha = "e".repeat(64);
    await db.insert(schema.assets).values({
      workspaceId: wsE,
      sha256: sha,
      kind: "image",
      originalName: "foto.png",
      width: 10,
      height: 10,
      bytes: 1,
      variants: [],
    });
    const document = minimalExpose("mit-bild", "Mit Bild");
    document.blocks[0] = {
      ...document.blocks[0]!,
      image: { src: "assets/foto.png", alt: "Ein Foto" },
    } as (typeof document.blocks)[0];
    const missing = await rejection(publish(dora.id, wsD, document));
    expect(missing.issues).toEqual([
      { path: "assets/foto.png", message: "Datei fehlt im Upload." },
    ]);
    const error = await rejection(
      withTenant(db, { userId: dora.id, workspaceId: wsD }, (tx) =>
        publishExpose(
          tx,
          { workspaceId: wsD, userId: dora.id, source: "api" },
          { document, assets: [{ path: "assets/foto.png", sha256: sha }] },
        ),
      ),
    );
    expect(error.issues).toEqual([
      { path: "assets/foto.png", message: "Datei wurde noch nicht hochgeladen." },
    ]);
  });

  it("rejects a contact pointing at another workspace's prospect", async () => {
    const message = await withTenant(db, { userId: dora.id, workspaceId: wsD }, (tx) =>
      tx.insert(schema.contacts).values({ workspaceId: wsD, prospectId: foreign.prospectId }),
    ).then(
      () => "inserted",
      (error: { cause?: { message?: string } }) => error.cause?.message ?? String(error),
    );
    expect(message).toMatch(/foreign key/);
  });
});

describe("public reads", () => {
  it("loads an exposé only on its own workspace", async () => {
    expect((await loadPublicExpose(db, wsD, first.slug))?.expose.id).toBe(first.exposeId);
    expect(await loadPublicExpose(db, wsE, first.slug)).toBeNull();
  });

  it("hides an exposé once it is taken offline", async () => {
    await db
      .update(schema.exposes)
      .set({ unpublishedAt: new Date() })
      .where(eq(schema.exposes.id, foreign.exposeId));
    expect(await loadPublicExpose(db, wsE, foreign.slug)).toBeNull();
    await db
      .update(schema.exposes)
      .set({ unpublishedAt: null })
      .where(eq(schema.exposes.id, foreign.exposeId));
  });

  it("records an opt-out only for the host's workspace", async () => {
    expect(await optOutByExposeSlug(db, wsE, first.slug)).toBe(false);
    expect(await optOutByExposeSlug(db, wsD, first.slug)).toBe(true);
    expect(await optOutByExposeSlug(db, wsD, first.slug)).toBe(true);
    const rows = await db
      .select({ id: schema.prospects.id, status: schema.prospects.status })
      .from(schema.prospects)
      .where(eq(schema.prospects.key, "baeckerei"));
    const status = Object.fromEntries(rows.map((row) => [row.id, row.status]));
    expect(status[first.prospectId]).toBe("no_interest");
    expect(status[foreign.prospectId]).not.toBe("no_interest");
    const audits = await db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "prospect.opted_out"));
    expect(audits).toHaveLength(1);
  });
});
