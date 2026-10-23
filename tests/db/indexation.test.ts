import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { INDEX_EMAIL_BODY, INDEX_EMAIL_SUBJECT } from "@/domain/invoices/indexation";
import { billingProfileSchema, type InvoiceLine } from "@/domain/invoices/schema";
import { getInfra } from "@/infra";
import { publishExpose } from "@/server/exposes/publish";
import { loadContract, runContractBilling, runFinalOverage } from "@/server/invoices/contracts";
import {
  announceAdjustment,
  runIndexReminders,
  saveIndexation,
  withdrawAdjustment,
} from "@/server/invoices/indexation";
import { addTimeEntry, deleteTimeEntry } from "@/server/invoices/time-entries";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** §7.10 phase 7c-3b: Wertsicherung (VPI) and Stundenkontingent of maintenance contracts. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const ida = { id: "user-index-ida", email: "ida@index.test", name: "Ida" };
let ws = "";
let actor: Actor;
let prospectId = "";

const send = vi.spyOn(getInfra().email, "send");
vi.spyOn(getInfra().push, "send");

const asIda = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: ida.id, workspaceId: ws }, fn);

const care: InvoiceLine = {
  id: "care",
  title: "Wartung",
  description: "",
  quantity: 1,
  unit: "Monat",
  unitPriceCents: 9_000,
  discountPercent: 0,
  vatRate: 0,
};

async function contract(values: Partial<typeof schema.maintenanceContracts.$inferInsert>) {
  const [row] = await db
    .insert(schema.maintenanceContracts)
    .values({
      workspaceId: ws,
      prospectId,
      title: "Wartung Gärtnerei",
      interval: "monthly",
      lines: [care],
      startDate: "2026-01-01",
      ...values,
    })
    .returning();
  return row!;
}

async function reload(id: string) {
  const [row] = await db
    .select()
    .from(schema.maintenanceContracts)
    .where(eq(schema.maintenanceContracts.id, id));
  return row!;
}

const announce = (contractId: string, indexMonth: string, indexTenths: number, now: Date) =>
  announceAdjustment(
    asIda,
    actor,
    {
      contractId,
      indexMonth,
      indexTenths,
      to: "buchhaltung@gaertnerei.test",
      subject: INDEX_EMAIL_SUBJECT,
      body: INDEX_EMAIL_BODY,
    },
    now,
  );

beforeAll(async () => {
  await db.insert(schema.users).values([ida]);
  const created = await createWorkspace(db, { userId: ida.id, name: "Studio I", slug: "studio-i" });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  actor = { userId: ida.id, role: "owner", workspaceId: ws };
  await db
    .update(schema.workspaceSettings)
    .set({
      senderAddress: {
        company: "Studio I",
        street: "Hauptstraße 1",
        postalCode: "1010",
        city: "Wien",
        country: "AT",
      },
      billing: { taxMode: "small_business", iban: "AT611904300234573201", paymentTermsDays: 14 },
    })
    .where(eq(schema.workspaceSettings.workspaceId, ws));
  const published = await asIda((tx) =>
    publishExpose(
      tx,
      { workspaceId: ws, userId: ida.id, source: "api" },
      { document: minimalExpose("gaertnerei-i", "Gärtnerei I"), assets: [] },
    ),
  );
  prospectId = published.prospectId;
  await db
    .update(schema.prospects)
    .set({ billing: billingProfileSchema.parse({ email: "buchhaltung@gaertnerei.test" }) })
    .where(eq(schema.prospects.id, prospectId));
});

afterAll(async () => {
  // The hourly jobs look across workspaces: leave nothing to bill or remind for other files.
  await db
    .update(schema.maintenanceContracts)
    .set({
      endDate: sql`${schema.maintenanceContracts.billedUntil}`,
      overageBilledUntil: sql`${schema.maintenanceContracts.billedUntil}`,
      indexed: false,
    })
    .where(eq(schema.maintenanceContracts.workspaceId, ws));
  await db
    .update(schema.tasks)
    .set({ doneAt: new Date() })
    .where(eq(schema.tasks.workspaceId, ws));
  await close();
});

describe("Wertsicherung", () => {
  let id = "";

  it("needs a base and reminds once per cycle before the notice is due", async () => {
    const created = await contract({ billedUntil: "2026-11-30" });
    id = created.id;
    expect(
      await asIda((tx) =>
        saveIndexation(tx, actor, id, {
          indexed: true,
          indexMonth: 1,
          baseMonth: null,
          baseTenths: null,
          thresholdPercent: 2,
        }),
      ),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(
      await asIda((tx) =>
        saveIndexation(tx, actor, id, {
          indexed: true,
          indexMonth: 1,
          baseMonth: "2025-09",
          baseTenths: 1287,
          thresholdPercent: 2,
        }),
      ),
    ).toEqual({ ok: true });
    // Due 1.1.2027, notice 30 days: the task is due 2.12. and appears two weeks before.
    const indexTasks = () => db.select().from(schema.tasks).where(eq(schema.tasks.contractId, id));
    await runIndexReminders(db, new Date("2026-11-10T09:00:00Z"));
    expect(await indexTasks()).toHaveLength(0);
    await runIndexReminders(db, new Date("2026-11-20T09:00:00Z"));
    await runIndexReminders(db, new Date("2026-11-21T09:00:00Z"));
    const [task, ...more] = await indexTasks();
    expect(more).toHaveLength(0);
    expect(task).toMatchObject({
      title: "Wertsicherung prüfen: Wartung Gärtnerei",
      dueDate: "2026-12-02",
      doneAt: null,
    });
  });

  it("announces the new prices by mail, without attachment, and can withdraw them", async () => {
    const now = new Date("2026-11-20T09:00:00Z");
    send.mockClear();
    expect(await announce(id, "2025-08", 1326, now)).toMatchObject({ ok: false, error: "invalid" });
    expect(await announce(id, "2026-09", 1326, now)).toEqual({
      ok: true,
      status: "announced",
      effectiveFrom: "2027-01-01",
    });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0]![0];
    expect(mail.attachments).toBeUndefined();
    expect(mail.subject).toBe("Wertsicherung Ihres Wartungsvertrags ab 01.01.2027");
    expect(mail.text).toContain("von 128,7 (September 2025) auf 132,6 (September 2026) gestiegen");
    expect(mail.text).toMatch(/Wartung: 90,00\s€ → 92,73\s€ pro Monat/);
    const open = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.contractId, id), isNull(schema.tasks.doneAt)));
    expect(open).toHaveLength(0);
    const [logged] = await db
      .select()
      .from(schema.outboundEmails)
      .where(eq(schema.outboundEmails.contractId, id));
    expect(logged).toMatchObject({ kind: "contract_notice", status: "sent" });

    // One announcement at a time; the base stays fixed meanwhile.
    expect(await announce(id, "2026-10", 1330, now)).toMatchObject({ ok: false });
    expect(
      await asIda((tx) =>
        saveIndexation(tx, actor, id, {
          indexed: true,
          indexMonth: 1,
          baseMonth: "2025-10",
          baseTenths: 1290,
          thresholdPercent: 2,
        }),
      ),
    ).toMatchObject({ ok: false, error: "locked" });

    const loaded = await asIda((tx) => loadContract(tx, ws, id, now));
    const announced = loaded!.adjustments.find((row) => row.status === "announced")!;
    expect(loaded!.indexDue).toBeNull();
    expect(await asIda((tx) => withdrawAdjustment(tx, actor, id, announced.id))).toEqual({
      ok: true,
    });
    expect((await asIda((tx) => loadContract(tx, ws, id, now)))!.indexDue).toBe("2027-01-01");
    expect(await announce(id, "2026-09", 1326, now)).toMatchObject({ status: "announced" });
  });

  it("applies the change with the first invoice from the effective day", async () => {
    await runContractBilling(db, new Date("2026-12-01T09:00:00Z"));
    const december = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.contractId, id),
          eq(schema.invoices.contractPeriodFrom, "2026-12-01"),
        ),
      );
    expect(december[0]!.document.lines.map((line) => line.unitPriceCents)).toEqual([9_000]);
    await runContractBilling(db, new Date("2027-01-01T09:00:00Z"));
    const [january] = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.contractId, id),
          eq(schema.invoices.contractPeriodFrom, "2027-01-01"),
        ),
      );
    expect(january!.document.lines[0]!.unitPriceCents).toBe(9_273);
    const after = await reload(id);
    expect([after.indexBaseMonth, after.indexBaseTenths]).toEqual(["2026-09", 1326]);
    expect(after.lines[0]!.unitPriceCents).toBe(9_273);
    const statuses = await db
      .select({ status: schema.contractAdjustments.status })
      .from(schema.contractAdjustments)
      .where(eq(schema.contractAdjustments.contractId, id));
    expect(statuses.map((row) => row.status).sort()).toEqual(["applied", "withdrawn"]);
    // The next cycle is a year after the new prices.
    const loaded = await asIda((tx) => loadContract(tx, ws, id, new Date("2027-01-02T09:00:00Z")));
    expect(loaded!.indexDue).toBe("2028-01-01");
  });

  it("records „keine Anpassung“ inside the threshold without a mail", async () => {
    const small = await contract({
      title: "Wartung klein",
      indexed: true,
      indexBaseMonth: "2025-09",
      indexBaseTenths: 1287,
      indexThresholdPercent: 2,
      billedUntil: "2026-11-30",
      endDate: "2027-06-30",
    });
    send.mockClear();
    expect(await announce(small.id, "2026-09", 1300, new Date("2026-11-20T09:00:00Z"))).toEqual({
      ok: true,
      status: "skipped",
      effectiveFrom: null,
    });
    expect(send).not.toHaveBeenCalled();
    expect((await reload(small.id)).indexBaseTenths).toBe(1287);
    // The contract ends before the next cycle.
    const loaded = await asIda((tx) => loadContract(tx, ws, small.id));
    expect(loaded!.indexDue).toBeNull();
  });
});

describe("Stundenkontingent", () => {
  it("bills hours beyond the quota with the next invoice and locks them", async () => {
    const quota = await contract({
      title: "Wartung mit Stunden",
      billedUntil: "2026-10-31",
      includedMinutes: 60,
      hourlyRateCents: 8_500,
    });
    const add = (workDate: string, minutes: number, description: string) =>
      asIda((tx) => addTimeEntry(tx, actor, quota.id, { workDate, minutes, description }));
    expect(await add("2026-11-05", 90, "Plugin-Updates")).toEqual({ ok: true });
    expect(await add("2026-11-20", 45, "Neue Unterseite")).toEqual({ ok: true });
    expect(await add("2025-12-01", 30, "Vor dem Beginn")).toMatchObject({ ok: false });
    await runContractBilling(db, new Date("2026-11-01T09:00:00Z"));
    await runContractBilling(db, new Date("2026-12-01T09:00:00Z"));
    const [december] = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.contractId, quota.id),
          eq(schema.invoices.contractPeriodFrom, "2026-12-01"),
        ),
      );
    // 2,25 h worked, 1 h included: 1,25 h at 85 €.
    expect(december!.document.lines[1]).toMatchObject({
      id: "extra-hours",
      quantity: 1.25,
      unitPriceCents: 8_500,
    });
    expect(december!.document.lines[1]!.description).toContain(
      "05.11.2026 1,5 Std. Plugin-Updates",
    );
    expect((await reload(quota.id)).overageBilledUntil).toBe("2026-11-30");
    expect(await add("2026-11-25", 30, "Nachgetragen")).toMatchObject({ error: "locked" });
    const [entry] = await db
      .select()
      .from(schema.contractTimeEntries)
      .where(eq(schema.contractTimeEntries.contractId, quota.id));
    expect(await asIda((tx) => deleteTimeEntry(tx, actor, quota.id, entry!.id))).toMatchObject({
      error: "locked",
    });
  });

  it("drafts a final invoice for the last period's hours after the end", async () => {
    const ended = await contract({
      title: "Wartung beendet",
      startDate: "2026-06-01",
      endDate: "2026-11-30",
      billedUntil: "2026-11-30",
      overageBilledUntil: "2026-10-31",
      hourlyRateCents: 8_500,
    });
    await db.insert(schema.contractTimeEntries).values({
      workspaceId: ws,
      contractId: ended.id,
      workDate: "2026-11-10",
      minutes: 50,
      description: "Umzug",
    });
    const finals = () =>
      db.select().from(schema.invoices).where(eq(schema.invoices.contractId, ended.id));
    await runFinalOverage(db, new Date("2026-11-30T09:00:00Z"));
    expect(await finals()).toHaveLength(0);
    await runFinalOverage(db, new Date("2026-12-01T09:00:00Z"));
    await runFinalOverage(db, new Date("2026-12-02T09:00:00Z"));
    const [final, ...more] = await finals();
    expect(more).toHaveLength(0);
    const approvals = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.invoiceId, final!.id));
    expect(approvals).toHaveLength(1);
    expect(final!.document.servicePeriod).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(final!.document.lines).toEqual([
      expect.objectContaining({ id: "extra-hours", quantity: 1 }),
    ]);
  });
});
