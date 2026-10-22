import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
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
  saveInvoiceDraft,
} from "@/server/invoices/manage";
import { createOffer, saveOfferDraft, sendOffer } from "@/server/offers/manage";
import { answerOffer } from "@/server/offers/public";
import { deleteProject } from "@/server/projects";
import { deleteProspect } from "@/server/prospects/mutations";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** §7.10 phase 7b: invoices from an accepted offer, numbering, immutability, storno, payments. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const ida = { id: "user-ida", email: "ida@i.test", name: "Ida" };
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
    const [deposit] = await invoicesOfOffer();
    const result = await asIda((tx) => cancelInvoice(tx, actor, deposit!.id, now));
    expect(result).toMatchObject({ ok: true, number: "RE-2026-0003" });
    expect(await asIda((tx) => cancelInvoice(tx, actor, deposit!.id, now))).toEqual({
      ok: false,
      error: "locked",
    });
    const rows = await invoicesOfOffer();
    const original = rows.find((row) => row.id === deposit!.id)!;
    const cancellation = rows.find((row) => row.kind === "cancellation")!;
    expect(original.status).toBe("cancelled");
    expect(cancellation).toMatchObject({ status: "issued", cancelsInvoiceId: deposit!.id });
    expect(cancellation.totals!.totalCents).toBe(-144_000);
    expect(cancellation.document.title).toBe("Storno zu RE-2026-0001");

    const csv = await asIda((tx) => monthCsvRows(tx, ws, "2026-10", now));
    expect(csv.map((row) => [row.number, row.totalCents, row.cancels])).toEqual([
      ["RE-2026-0001", 144_000, null],
      ["RE-2026-0002", 360_000, null],
      ["RE-2026-0003", -144_000, "RE-2026-0001"],
    ]);
  });

  it("can bill a cancelled instalment again", async () => {
    expect(await asIda((tx) => createInvoicesFromOffer(tx, actor, offerId, now))).toEqual({
      created: 1,
    });
    const again = (await invoicesOfOffer()).filter(
      (row) => row.status === "draft" && row.kind === "deposit",
    );
    expect(again).toHaveLength(1);
    await asIda((tx) => deleteInvoiceDraft(tx, actor, again[0]!.id));
  });

  it("exports invoices and payments with the customer (Art. 15)", async () => {
    const data = await asIda((tx) => exportProspect(tx, ws, prospectId));
    expect(data!.tables.invoices).toHaveLength(3);
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
});
