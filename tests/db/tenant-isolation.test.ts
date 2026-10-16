import { eq, getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { publishExpose } from "@/server/exposes/publish";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/**
 * §9a: "Workspace A never sees data of workspace B." Runs as the real tenant
 * role against the real migrations.
 */

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const alice = { id: "user-alice", email: "alice@a.test", name: "Alice" };
const bob = { id: "user-bob", email: "bob@b.test", name: "Bob" };
const carol = { id: "user-carol", email: "carol@both.test", name: "Carol" };
let wsA = "";
let wsB = "";

/** Tables holding workspace data; each gets one row per workspace below. */
const tenantTables = {
  workspace_settings: schema.workspaceSettings,
  domains: schema.domains,
  integrations: schema.integrations,
  usage_events: schema.usageEvents,
  api_tokens: schema.apiTokens,
  audit_log: schema.auditLog,
  memberships: schema.memberships,
  prospects: schema.prospects,
  contacts: schema.contacts,
  exposes: schema.exposes,
  expose_versions: schema.exposeVersions,
  assets: schema.assets,
  touchpoints: schema.touchpoints,
  visits: schema.visits,
  events: schema.events,
  saved_views: schema.savedViews,
  chat_threads: schema.chatThreads,
  chat_messages: schema.chatMessages,
  chat_drafts: schema.chatDrafts,
  callback_requests: schema.callbackRequests,
  member_presence: schema.memberPresence,
} satisfies Record<string, PgTable>;

async function seedWorkspaceData(workspaceId: string, tag: string, userId: string) {
  await db.insert(schema.domains).values({ workspaceId, hostname: `go.${tag}.test` });
  await db
    .insert(schema.integrations)
    .values({ workspaceId, kind: "pingen", secretCiphertext: `secret-${tag}` });
  await db.insert(schema.usageEvents).values({ workspaceId, kind: "visit" });
  await db
    .insert(schema.apiTokens)
    .values({ workspaceId, name: tag, prefix: tag, tokenHash: `hash-${tag}` });
  await db.insert(schema.assets).values({
    workspaceId,
    sha256: tag.repeat(64),
    kind: "image",
    originalName: `${tag}.png`,
    bytes: 1,
    variants: [],
  });
  await withTenant(db, { userId, workspaceId }, (tx) =>
    publishExpose(
      tx,
      { workspaceId, userId, source: "seed" },
      { document: minimalExpose(`kunde-${tag}`, `Kunde ${tag}`), assets: [] },
    ),
  );
  // Publishing created the letter touchpoint; add a visit with one event.
  const [expose] = await db
    .select()
    .from(schema.exposes)
    .where(eq(schema.exposes.workspaceId, workspaceId));
  const [visit] = await db
    .insert(schema.visits)
    .values({ workspaceId, prospectId: expose!.prospectId, exposeId: expose!.id, source: "direct" })
    .returning();
  await db.insert(schema.events).values({
    workspaceId,
    visitId: visit!.id,
    exposeId: expose!.id,
    type: "page_view",
    occurredAt: new Date(),
  });
  await db.insert(schema.savedViews).values({ workspaceId, name: tag, query: "status=opened" });
  const chat = { workspaceId, prospectId: expose!.prospectId, exposeId: expose!.id };
  const [thread] = await db
    .insert(schema.chatThreads)
    .values({ ...chat, visitId: visit!.id })
    .returning();
  await db
    .insert(schema.chatMessages)
    .values({ workspaceId, threadId: thread!.id, author: "visitor", body: `Hallo ${tag}` });
  await db
    .insert(schema.chatDrafts)
    .values({ workspaceId, prospectId: chat.prospectId, visitId: visit!.id, length: 12 });
  await db
    .insert(schema.callbackRequests)
    .values({ ...chat, name: `Kunde ${tag}`, phone: "0341 123456" });
  await db.insert(schema.memberPresence).values({ workspaceId, userId });
}

beforeAll(async () => {
  await db.insert(schema.users).values([alice, bob, carol]);
  const a = await createWorkspace(db, { userId: alice.id, name: "Agentur A", slug: "agentur-a" });
  const b = await createWorkspace(db, { userId: bob.id, name: "Agentur B", slug: "agentur-b" });
  if (!a.ok || !b.ok) throw new Error("workspace setup failed");
  wsA = a.workspace.id;
  wsB = b.workspace.id;
  await db.insert(schema.memberships).values([
    { workspaceId: wsA, userId: carol.id, role: "member" },
    { workspaceId: wsB, userId: carol.id, role: "member" },
  ]);
  await seedWorkspaceData(wsA, "a", alice.id);
  await seedWorkspaceData(wsB, "b", bob.id);
});

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? String(error);
  }
  throw new Error("expected the query to fail");
}

afterAll(async () => {
  await close();
});

describe("tenant isolation", () => {
  it("shows a member only their own workspace's rows in every tenant table", async () => {
    await withTenant(db, { userId: alice.id, workspaceId: wsA }, async (tx) => {
      for (const [name, table] of Object.entries(tenantTables)) {
        const columns = getTableColumns(table) as Record<string, unknown>;
        expect(columns.workspaceId, name).toBeDefined();
        const rows = (await tx.select().from(table)) as { workspaceId: string }[];
        expect(rows.length, `${name} should have rows for A`).toBeGreaterThan(0);
        expect(new Set(rows.map((row) => row.workspaceId)), name).toEqual(new Set([wsA]));
      }
      const workspaces = await tx.select({ id: schema.workspaces.id }).from(schema.workspaces);
      expect(workspaces).toEqual([{ id: wsA }]);
    });
  });

  it("shows nothing when a user claims a workspace they do not belong to", async () => {
    await withTenant(db, { userId: alice.id, workspaceId: wsB }, async (tx) => {
      for (const [name, table] of Object.entries(tenantTables)) {
        expect(await tx.select().from(table), name).toEqual([]);
      }
      expect(await tx.select({ id: schema.workspaces.id }).from(schema.workspaces)).toEqual([]);
    });
  });

  it("refuses writes into a foreign workspace", async () => {
    expect(
      await dbError(
        withTenant(db, { userId: alice.id, workspaceId: wsA }, (tx) =>
          tx.insert(schema.domains).values({ workspaceId: wsB, hostname: "evil.test" }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await dbError(
        withTenant(db, { userId: alice.id, workspaceId: wsB }, (tx) =>
          tx.insert(schema.domains).values({ workspaceId: wsB, hostname: "evil2.test" }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("cannot update or delete foreign rows (they are invisible)", async () => {
    await withTenant(db, { userId: alice.id, workspaceId: wsA }, async (tx) => {
      const updated = await tx
        .update(schema.integrations)
        .set({ secretCiphertext: "pwned" })
        .where(eq(schema.integrations.workspaceId, wsB))
        .returning({ id: schema.integrations.id });
      expect(updated).toEqual([]);
      const deleted = await tx
        .delete(schema.domains)
        .where(eq(schema.domains.workspaceId, wsB))
        .returning({ id: schema.domains.id });
      expect(deleted).toEqual([]);
    });
    const [secretB] = await db
      .select({ secret: schema.integrations.secretCiphertext })
      .from(schema.integrations)
      .where(eq(schema.integrations.workspaceId, wsB));
    expect(secretB?.secret).toBe("secret-b");
  });

  it("scopes a member of several workspaces to the selected one", async () => {
    for (const [workspaceId, hostname] of [
      [wsA, "go.a.test"],
      [wsB, "go.b.test"],
    ] as const) {
      const rows = await withTenant(db, { userId: carol.id, workspaceId }, (tx) =>
        tx.select({ hostname: schema.domains.hostname }).from(schema.domains),
      );
      expect(rows).toEqual([{ hostname }]);
    }
  });

  it("lets plain members read but not change memberships or the workspace", async () => {
    await withTenant(db, { userId: carol.id, workspaceId: wsA }, async (tx) => {
      const members = await tx
        .select({ userId: schema.memberships.userId })
        .from(schema.memberships);
      expect(members.map((m) => m.userId).sort()).toEqual([alice.id, carol.id]);
      const promoted = await tx
        .update(schema.memberships)
        .set({ role: "owner" })
        .where(eq(schema.memberships.userId, carol.id))
        .returning({ id: schema.memberships.id });
      expect(promoted).toEqual([]);
      const renamed = await tx
        .update(schema.workspaces)
        .set({ name: "Hijacked" })
        .returning({ id: schema.workspaces.id });
      expect(renamed).toEqual([]);
    });
  });

  it("only reveals users who share the current workspace", async () => {
    const visible = await withTenant(db, { userId: alice.id, workspaceId: wsA }, (tx) =>
      tx.select({ id: schema.users.id }).from(schema.users),
    );
    expect(visible.map((u) => u.id).sort()).toEqual([alice.id, carol.id]);
  });

  it("sees nothing without a tenant context", async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role aquisiteur_app`);
      return tx.select().from(schema.domains);
    });
    expect(rows).toEqual([]);
  });

  it("denies the tenant role any access to auth internals", async () => {
    for (const table of [
      "sessions",
      "accounts",
      "verifications",
      "passkeys",
      "rate_limits",
      "platform_admins",
    ]) {
      const message = await dbError(
        withTenant(db, { userId: alice.id, workspaceId: wsA }, (tx) =>
          tx.execute(sql`select 1 from ${sql.identifier(table)} limit 1`),
        ),
      );
      expect(message, table).toMatch(/permission denied/);
    }
  });

  it("keeps the audit log append-only for tenants", async () => {
    await withTenant(db, { userId: alice.id, workspaceId: wsA }, (tx) =>
      tx
        .insert(schema.auditLog)
        .values({ workspaceId: wsA, actorUserId: alice.id, action: "test.appended" }),
    );
    expect(
      await dbError(
        withTenant(db, { userId: alice.id, workspaceId: wsA }, (tx) =>
          tx.update(schema.auditLog).set({ action: "tampered" }),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await dbError(
        withTenant(db, { userId: alice.id, workspaceId: wsA }, (tx) => tx.delete(schema.auditLog)),
      ),
    ).toMatch(/permission denied/);
  });
});

describe("schema guard rails", () => {
  it("has row level security enabled on every table", async () => {
    const rows = await db.execute<{ table: string }>(sql`
      select c.relname as table from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    `);
    expect([...rows]).toEqual([]);
  });

  it("has a policy on every table with a workspace_id column", async () => {
    const rows = await db.execute<{ table: string }>(sql`
      select distinct c.table_name as table from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'workspace_id'
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.table_name)
    `);
    expect([...rows]).toEqual([]);
  });

  it("covers every workspace_id table in this test", async () => {
    const rows = await db.execute<{ table: string }>(sql`
      select distinct table_name as table from information_schema.columns
      where table_schema = 'public' and column_name = 'workspace_id' order by 1
    `);
    expect([...rows].map((r) => r.table).sort()).toEqual(Object.keys(tenantTables).sort());
  });
});
