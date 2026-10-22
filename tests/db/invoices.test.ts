import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { invoiceDocumentSchema } from "@/domain/invoices/schema";
import type { OfferDocument } from "@/domain/offers/schema";
import { getInfra } from "@/infra";
import { exportProspect } from "@/server/data-export";
import { publishExpose } from "@/server/exposes/publish";
import {
  addPayment,
  cancelInvoice,
  createInvoice,
  createInvoicesFromOffer,
  deleteInvoiceDraft,
  issueInvoice,
  listInvoices,
  loadInvoice,
  monthCsvRows,
  saveBillingProfile,
  saveInvoiceDraft,
  smallBusinessRevenue,
} from "@/server/invoices/manage";
import { createOffer, saveOfferDraft, sendOffer } from "@/server/offers/manage";
import { answerOffer, loadPublicOffer } from "@/server/offers/public";
import { deleteProject } from "@/server/projects";
import {
  addContact,
  deleteProspect,
  restrictProspect,
  setDoNotContact,
} from "@/server/prospects/mutations";
import { purgeRestrictedProspects } from "@/server/retention";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** §7.10 phase 7b: invoices from an accepted offer, numbering, immutability, storno, payments. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const ida = { id: "user-irma", email: "irma@rechnung.test", name: "Irma" };
const now = new Date("2026-10-22T10:00:00Z");
let ws = "";
let actor: Actor;
let prospectId = "";
let projectId = "";
let offerId = "";

vi.spyOn(getInfra().push, "send");

const asIda = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: ida.id, workspaceId: ws }, fn);

const offerDocument: OfferDocument = {
  title: "Neue Website",
  intro: undefined,
  outro: undefined,
  validDays: 30,
  discountPercent: 0,
  variants: [],
  items: [
    {
      id: "website",
      title: "Website",
      description: undefined,
      quantity: 1,
      unit: "Pauschal",
      unitPriceCents: 300_000,
      discountPercent: 0,
      vatRate: 20,
      billing: "once",
      optional: false,
      selected: true,
      variantIds: [],
    },
  ],
  paymentPlan: [
    { id: "m1", title: "Anzahlung", share: { kind: "percent", value: 40 }, trigger: "acceptance" },
    { id: "m2", title: "Go-live", share: { kind: "percent", value: 60 }, trigger: "milestone" },
  ],
  maintenance: { startOn: "go_live", minimumMonths: 12, noticeMonths: 3, timing: "advance" },
};

/** The Postgres message behind drizzle's "Failed query" wrapper. */
async function dbError(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    return String((error as { cause?: unknown }).cause ?? error);
  }
  return "no error";
}

async function invoicesOfOffer() {
  return db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.workspaceId, ws), eq(schema.invoices.offerId, offerId)))
    .orderBy(schema.invoices.createdAt);
}

beforeAll(async () => {
  await db.insert(schema.users).values([ida]);
  const created = await createWorkspace(db, {
    userId: ida.id,
    name: "Agentur I",
    slug: "agentur-rechnung-i",
  });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  actor = { userId: ida.id, role: "owner", workspaceId: ws };
  await db
    .update(schema.workspaceSettings)
    .set({
      senderAddress: {
        company: "Agentur I",
        street: "Hauptstraße 1",
        postalCode: "1010",
        city: "Wien",
        country: "AT",
      },
      billing: {
        taxMode: "standard",
        vatId: "ATU12345678",
        iban: "AT611904300234573201",
        paymentTermsDays: 14,
      },
    })
    .where(eq(schema.workspaceSettings.workspaceId, ws));
  const published = await asIda((tx) =>
    publishExpose(
      tx,
      { workspaceId: ws, userId: ida.id, source: "api" },
      { document: minimalExpose("tischlerei-ibl", "Tischlerei Ibl"), assets: [] },
    ),
  );
  prospectId = published.prospectId;
  await db
    .update(schema.prospects)
    .set({ street: "Gasse 2", postalCode: "8010", city: "Graz", country: "AT" })
    .where(eq(schema.prospects.id, prospectId));
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.prospectId, prospectId));
  projectId = project!.id;

  const sent = await asIda(async (tx) => {
    const id = (await createOffer(tx, actor, projectId))!;
    await saveOfferDraft(tx, actor, id, offerDocument);
    const result = await sendOffer(tx, actor, id, now);
    if (!result.ok) throw new Error(result.error);
    return { id, token: result.token };
  });
  offerId = sent.id;
  const [offer] = await db.select().from(schema.offers).where(eq(schema.offers.id, offerId));
  const accepted = await answerOffer(
    db,
    {
      workspaceId: ws,
      token: sent.token,
      internal: false,
      body: {
        answer: "accept",
        versionId: offer!.currentVersionId,
        name: "Ilse Ibl",
        confirmed: true,
        selection: { variantId: null, optionalIds: [] },
      },
    },
    now,
  );
  if (!("ok" in accepted)) throw new Error("offer not accepted");
});

afterAll(async () => {
  await close();
});

describe("invoices", () => {
  it("creates a deposit and a final draft from the accepted offer's plan, once", async () => {
    expect(await asIda((tx) => createInvoicesFromOffer(tx, actor, offerId, now))).toEqual({
      created: 2,
    });
    expect(await asIda((tx) => createInvoicesFromOffer(tx, actor, offerId, now))).toEqual({
      error: "nothing_left",
    });
    const [deposit, final] = await invoicesOfOffer();
    expect([deposit!.kind, final!.kind]).toEqual(["deposit", "final"]);
    expect(deposit!.status).toBe("draft");
    expect(deposit!.number).toBeNull();
    expect(deposit!.document.treatment).toBe("domestic");
    // 40 % of 3.600 € gross = 1.440 €, i.e. 1.200 € net under 20 %.
    expect(deposit!.document.lines).toEqual([
      expect.objectContaining({ unitPriceCents: 120_000, vatRate: 20 }),
    ]);
    expect(final!.document.lines).toEqual([
      expect.objectContaining({ id: "website", unitPriceCents: 300_000 }),
    ]);
  });

  it("numbers on issue and lets the final invoice deduct the issued deposit", async () => {
    const [deposit, final] = await invoicesOfOffer();
    const before = await asIda((tx) => loadInvoice(tx, ws, final!.id, now));
    expect(before!.document.deductions).toEqual([]);
    // Issued first, the final invoice would bill the deposit a second time.
    expect(await asIda((tx) => issueInvoice(tx, actor, final!.id, now))).toMatchObject({
      ok: false,
      error: "invalid",
      issues: [expect.objectContaining({ message: expect.stringMatching(/Anzahlungsrechnungen/) })],
    });

    expect(await asIda((tx) => issueInvoice(tx, actor, deposit!.id, now))).toEqual({
      ok: true,
      number: "RE-2026-0001",
    });
    const loaded = await asIda((tx) => loadInvoice(tx, ws, final!.id, now));
    expect(loaded!.document.deductions).toEqual([
      expect.objectContaining({
        number: "RE-2026-0001",
        byRate: [{ rate: 20, netCents: 120_000, vatCents: 24_000 }],
      }),
    ]);
    expect(loaded!.totals.totalCents).toBe(360_000);
    expect(loaded!.totals.dueCents).toBe(216_000);

    expect(await asIda((tx) => issueInvoice(tx, actor, final!.id, now))).toEqual({
      ok: true,
      number: "RE-2026-0002",
    });
    const [, issued] = await invoicesOfOffer();
    expect(issued).toMatchObject({
      status: "issued",
      issueDate: "2026-10-22",
      dueDate: "2026-11-05",
      issuer: expect.objectContaining({ name: "Agentur I", vatId: "ATU12345678" }),
      recipient: expect.objectContaining({ name: "Tischlerei Ibl", city: "Graz" }),
    });
    expect(issued!.totals!.dueCents).toBe(216_000);
    expect(issued!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await asIda((tx) => saveInvoiceDraft(tx, actor, final!.id, final!.document))).toEqual(
      expect.objectContaining({ ok: false, error: "locked" }),
    );
  });

  it("refuses to issue without the mandatory contents", async () => {
    const draftId = await asIda((tx) => createInvoice(tx, actor, { prospectId, projectId }, now));
    const result = await asIda((tx) => issueInvoice(tx, actor, draftId!, now));
    expect(result).toMatchObject({ ok: false, error: "invalid" });
    await asIda((tx) => deleteInvoiceDraft(tx, actor, draftId!));
  });

  it("keeps issued invoices unchanged at database level", async () => {
    const [deposit] = await invoicesOfOffer();
    expect(
      await dbError(
        db
          .update(schema.invoices)
          .set({ number: "RE-2026-9999" })
          .where(eq(schema.invoices.id, deposit!.id)),
      ),
    ).toMatch(/cannot be changed/);
    expect(
      await dbError(
        db
          .update(schema.invoices)
          .set({ status: "cancelled", taxNote: "geändert" })
          .where(eq(schema.invoices.id, deposit!.id)),
      ),
    ).toMatch(/cannot be changed/);
    expect(
      await dbError(db.delete(schema.invoices).where(eq(schema.invoices.id, deposit!.id))),
    ).toMatch(/cannot be deleted/);
  });

  it("records partial and full payments", async () => {
    const [, final] = await invoicesOfOffer();
    expect(
      await asIda((tx) =>
        addPayment(tx, actor, final!.id, { amountCents: 100_000, paidOn: "2026-10-25" }),
      ),
    ).toBe("ok");
    const status = async () =>
      (await asIda((tx) => listInvoices(tx, ws, { offerId }, now))).find(
        (entry) => entry.id === final!.id,
      )!;
    expect(await status()).toMatchObject({ status: "partly_paid", paidCents: 100_000 });
    await asIda((tx) =>
      addPayment(tx, actor, final!.id, { amountCents: 116_000, paidOn: "2026-10-30" }),
    );
    expect((await status()).status).toBe("paid");
  });

  it("corrects only by storno: a cancellation with its own number and negative amounts", async () => {
    const [deposit, final] = await invoicesOfOffer();
    // The issued final invoice subtracts the deposit, so it has to go first.
    expect(await asIda((tx) => cancelInvoice(tx, actor, deposit!.id, now))).toEqual({
      ok: false,
      error: "deducted",
      by: "RE-2026-0002",
    });
    expect(await asIda((tx) => cancelInvoice(tx, actor, final!.id, now))).toMatchObject({
      ok: true,
      number: "RE-2026-0003",
    });
    expect(await asIda((tx) => cancelInvoice(tx, actor, deposit!.id, now))).toMatchObject({
      ok: true,
      number: "RE-2026-0004",
    });
    expect(await asIda((tx) => cancelInvoice(tx, actor, deposit!.id, now))).toEqual({
      ok: false,
      error: "locked",
    });
    const rows = await invoicesOfOffer();
    const original = rows.find((row) => row.id === deposit!.id)!;
    const cancellation = rows.find(
      (row) => row.kind === "cancellation" && row.cancelsInvoiceId === deposit!.id,
    )!;
    expect(original.status).toBe("cancelled");
    expect(cancellation.status).toBe("issued");
    expect(cancellation.totals!.totalCents).toBe(-144_000);
    expect(cancellation.document.title).toBe("Storno zu RE-2026-0001");

    const csv = await asIda((tx) => monthCsvRows(tx, ws, "2026-10", now));
    expect(csv.map((row) => [row.number, row.totalCents, row.cancels])).toEqual([
      ["RE-2026-0001", 144_000, null],
      ["RE-2026-0002", 360_000, null],
      ["RE-2026-0003", -360_000, "RE-2026-0002"],
      ["RE-2026-0004", -144_000, "RE-2026-0001"],
    ]);
  });

  it("can bill cancelled instalments again", async () => {
    expect(await asIda((tx) => createInvoicesFromOffer(tx, actor, offerId, now))).toEqual({
      created: 2,
    });
    const again = (await invoicesOfOffer()).filter((row) => row.status === "draft");
    expect(again.map((row) => row.kind)).toEqual(["deposit", "final"]);
    for (const row of again) await asIda((tx) => deleteInvoiceDraft(tx, actor, row.id));
  });

  it("counts what was billed against the small-business limit, net of deposits and stornos", async () => {
    const base = {
      workspaceId: ws,
      prospectId,
      status: "issued" as const,
      document: invoiceDocumentSchema.parse({ treatment: "small_business" }),
    };
    const totals = (totalCents: number, deductedCents = 0) =>
      ({ totalCents, deductedCents }) as never;
    await db.insert(schema.invoices).values([
      {
        ...base,
        kind: "deposit",
        number: "RE-2027-0001",
        issueDate: "2027-01-10",
        totals: totals(100_000),
      },
      {
        ...base,
        kind: "final",
        number: "RE-2027-0002",
        issueDate: "2027-02-10",
        totals: totals(300_000, 100_000),
      },
      {
        ...base,
        kind: "standard",
        number: "RE-2027-0003",
        issueDate: "2027-03-10",
        totals: totals(50_000),
      },
      {
        ...base,
        kind: "cancellation",
        number: "RE-2027-0004",
        issueDate: "2027-03-11",
        totals: totals(-50_000),
      },
      {
        ...base,
        kind: "standard",
        number: "RE-2028-0001",
        issueDate: "2028-01-02",
        totals: totals(70_000),
      },
      {
        ...base,
        document: invoiceDocumentSchema.parse({ treatment: "domestic" }),
        number: "RE-2027-0005",
        issueDate: "2027-04-01",
        totals: totals(90_000),
      },
    ]);
    const revenue = await asIda((tx) => smallBusinessRevenue(tx, ws, 2027));
    expect(revenue.revenueCents).toBe(300_000);
    expect(revenue.guard.level).toBe("ok");
  });

  it("exports invoices and payments with the customer (Art. 15)", async () => {
    const data = await asIda((tx) => exportProspect(tx, ws, prospectId));
    expect(data!.tables.invoices).toHaveLength(10);
    expect(data!.tables.invoice_payments).toHaveLength(2);
    expect(data!.tables.audit_log!.map((row) => row.action)).toEqual(
      expect.arrayContaining(["invoice.issued", "invoice.paid", "invoice.cancelled"]),
    );
  });

  it("keeps customer and project for seven years once an invoice is issued", async () => {
    expect(await asIda((tx) => deleteProspect(tx, actor, prospectId))).toBe("retained");
    expect(await asIda((tx) => deleteProject(tx, actor, projectId))).toEqual({ error: "in_use" });
    const [prospect] = await db
      .select({ id: schema.prospects.id })
      .from(schema.prospects)
      .where(eq(schema.prospects.id, prospectId));
    expect(prospect).toBeDefined();
  });

  it("deletes a customer with only invoice drafts", async () => {
    const published = await asIda((tx) =>
      publishExpose(
        tx,
        { workspaceId: ws, userId: ida.id, source: "api" },
        { document: minimalExpose("cafe-ibl", "Café Ibl"), assets: [] },
      ),
    );
    await asIda((tx) => createInvoice(tx, actor, { prospectId: published.prospectId }, now));
    expect(await asIda((tx) => deleteProspect(tx, actor, published.prospectId))).toBe(true);
    const left = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.prospectId, published.prospectId));
    expect(left).toEqual([]);
  });

  it("restricts instead of deleting: keeps issued invoices, drops the rest (Sperrvermerk)", async () => {
    await db
      .update(schema.prospects)
      .set({ email: "info@ibl.test", phone: "+43 316 1", notes: "Mag Holz" })
      .where(eq(schema.prospects.id, prospectId));
    const issuedBefore = (await invoicesOfOffer()).filter((row) => row.status !== "draft");
    expect(await asIda((tx) => restrictProspect(tx, actor, prospectId, now))).toBe(true);

    const [prospect] = await db
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.id, prospectId));
    expect(prospect).toMatchObject({
      companyName: "Tischlerei Ibl",
      email: null,
      phone: null,
      notes: null,
      street: null,
      billing: null,
    });
    expect(prospect!.restrictedAt).toEqual(now);
    expect(prospect!.doNotContactAt).not.toBeNull();
    expect(prospect!.chatBlockedAt).not.toBeNull();
    for (const table of [schema.exposes, schema.contacts, schema.touchpoints, schema.letters]) {
      const rows = await db.select().from(table).where(eq(table.prospectId, prospectId));
      expect(rows).toEqual([]);
    }
    const kept = (await invoicesOfOffer()).filter((row) => row.status !== "draft");
    expect(kept.map((row) => row.id)).toEqual(issuedBefore.map((row) => row.id));
    expect((await invoicesOfOffer()).some((row) => row.status === "draft")).toBe(false);
    expect(await asIda((tx) => createInvoice(tx, actor, { prospectId }, now))).toBeNull();
    const [offer] = await db.select().from(schema.offers).where(eq(schema.offers.id, offerId));
    expect(await loadPublicOffer(db, ws, offer!.publicToken, now)).toBeNull();
    // The restriction cannot be lifted or filled with new personal data.
    expect(await asIda((tx) => setDoNotContact(tx, actor, prospectId, false))).toBe(false);
    expect(
      await asIda((tx) =>
        addContact(tx, actor, prospectId, { firstName: "Ilse", lastName: "Ibl" }),
      ),
    ).toBe(false);
    expect(
      await asIda((tx) =>
        saveBillingProfile(tx, actor, prospectId, {
          customerType: "business",
          name: undefined,
          street: undefined,
          postalCode: undefined,
          city: undefined,
          email: "neu@ibl.test",
        }),
      ),
    ).toBe(false);
    await expect(
      asIda((tx) =>
        publishExpose(
          tx,
          { workspaceId: ws, userId: ida.id, source: "api" },
          { document: minimalExpose("tischlerei-ibl", "Tischlerei Ibl"), assets: [] },
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    // Invoices of 2026 are kept until the end of 2033.
    expect(await purgeRestrictedProspects(db, ws, now)).toBe(0);
    const audit = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, prospectId));
    expect(audit.map((row) => row.action)).toContain("prospect.restricted");
  });

  it("deletes a restricted customer once its invoices are past the retention period", async () => {
    const published = await asIda((tx) =>
      publishExpose(
        tx,
        { workspaceId: ws, userId: ida.id, source: "api" },
        { document: minimalExpose("alt-ibl", "Altbau Ibl"), assets: [] },
      ),
    );
    const [template] = (await invoicesOfOffer()).filter((row) => row.status === "issued");
    const { id: _id, ...copy } = template!;
    const [old] = await db
      .insert(schema.invoices)
      .values({
        ...copy,
        prospectId: published.prospectId,
        projectId: null,
        offerId: null,
        milestoneId: null,
        cancelsInvoiceId: null,
        number: "2018-0001",
        issueDate: "2018-03-01",
        dueDate: "2018-03-15",
      })
      .returning();
    expect(await asIda((tx) => restrictProspect(tx, actor, published.prospectId, now))).toBe(true);
    expect(await purgeRestrictedProspects(db, ws, now)).toBe(1);
    const gone = await db
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.id, published.prospectId));
    expect(gone).toEqual([]);
    const invoice = await db.select().from(schema.invoices).where(eq(schema.invoices.id, old!.id));
    expect(invoice).toEqual([]);
    // A younger issued invoice still refuses deletion.
    expect(
      await dbError(db.delete(schema.invoices).where(eq(schema.invoices.id, template!.id))),
    ).toContain("cannot be deleted");
  });
});
