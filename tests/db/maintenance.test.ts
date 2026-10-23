import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { billingProfileSchema } from "@/domain/invoices/schema";
import type { OfferDocument } from "@/domain/offers/schema";
import { getInfra } from "@/infra";
import { publishExpose } from "@/server/exposes/publish";
import {
  createContractsFromOffer,
  listContracts,
  loadContract,
  runContractBilling,
  saveContract,
  setContractEnd,
} from "@/server/invoices/contracts";
import { issueInvoice } from "@/server/invoices/manage";
import { renderInvoicePdfOnServer } from "@/server/invoices/pdf";
import { createOffer, saveOfferDraft, sendOffer } from "@/server/offers/manage";
import { answerOffer } from "@/server/offers/public";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** §7.10 phase 7c-3: maintenance contracts, periodic billing, approval and automatic sending. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const wanda = { id: "user-wanda", email: "wanda@wartung.test", name: "Wanda" };
const accepted = new Date("2026-10-15T08:00:00Z");
let ws = "";
let actor: Actor;
let prospectId = "";
let offerId = "";

const send = vi.spyOn(getInfra().email, "send");
vi.spyOn(getInfra().push, "send");

const asWanda = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: wanda.id, workspaceId: ws }, fn);

const item = (patch: Partial<OfferDocument["items"][number]>): OfferDocument["items"][number] => ({
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
  ...patch,
});

const offerDocument: OfferDocument = {
  title: "Website mit Betreuung",
  intro: undefined,
  outro: undefined,
  validDays: 30,
  discountPercent: 10,
  variants: [],
  items: [
    item({}),
    item({
      id: "care",
      title: "Wartung",
      unit: "Monat",
      unitPriceCents: 9_300,
      billing: "monthly",
    }),
    item({
      id: "hosting",
      title: "Hosting",
      unit: "Jahr",
      unitPriceCents: 36_500,
      billing: "yearly",
    }),
  ],
  paymentPlan: [
    {
      id: "m1",
      title: "Bei Auftrag",
      share: { kind: "percent", value: 100 },
      trigger: "acceptance",
    },
  ],
  maintenance: { startOn: "acceptance", minimumMonths: 12, noticeMonths: 3, timing: "advance" },
};

async function contractByInterval(interval: "monthly" | "yearly") {
  const [row] = await db
    .select()
    .from(schema.maintenanceContracts)
    .where(
      and(
        eq(schema.maintenanceContracts.workspaceId, ws),
        eq(schema.maintenanceContracts.interval, interval),
      ),
    );
  return row!;
}

async function invoicesOf(contractId: string) {
  return db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.contractId, contractId))
    .orderBy(schema.invoices.contractPeriodFrom);
}

async function approvalTasks(invoiceId: string) {
  return db.select().from(schema.tasks).where(eq(schema.tasks.invoiceId, invoiceId));
}

beforeAll(async () => {
  await db.insert(schema.users).values([wanda]);
  const created = await createWorkspace(db, {
    userId: wanda.id,
    name: "Studio W",
    slug: "studio-wartung-w",
  });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  actor = { userId: wanda.id, role: "owner", workspaceId: ws };
  await db
    .update(schema.workspaceSettings)
    .set({
      senderAddress: {
        company: "Studio W",
        street: "Hauptstraße 1",
        postalCode: "1010",
        city: "Wien",
        country: "AT",
      },
      billing: { taxMode: "small_business", iban: "AT611904300234573201", paymentTermsDays: 14 },
    })
    .where(eq(schema.workspaceSettings.workspaceId, ws));
  const published = await asWanda((tx) =>
    publishExpose(
      tx,
      { workspaceId: ws, userId: wanda.id, source: "api" },
      { document: minimalExpose("gaertnerei-w", "Gärtnerei W"), assets: [] },
    ),
  );
  prospectId = published.prospectId;
  await db
    .update(schema.prospects)
    .set({
      street: "Gasse 2",
      postalCode: "8010",
      city: "Graz",
      country: "AT",
      billing: billingProfileSchema.parse({ email: "buchhaltung@gaertnerei.test" }),
    })
    .where(eq(schema.prospects.id, prospectId));
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.prospectId, prospectId));
  const sent = await asWanda(async (tx) => {
    const id = (await createOffer(tx, actor, project!.id))!;
    await saveOfferDraft(tx, actor, id, offerDocument);
    const result = await sendOffer(tx, actor, id, accepted);
    if (!result.ok) throw new Error(result.error);
    return { id, token: result.token };
  });
  offerId = sent.id;
  const [offer] = await db.select().from(schema.offers).where(eq(schema.offers.id, offerId));
  const answer = await answerOffer(
    db,
    {
      workspaceId: ws,
      token: sent.token,
      internal: false,
      body: {
        answer: "accept",
        versionId: offer!.currentVersionId,
        name: "Gerda W",
        confirmed: true,
        selection: { variantId: null, optionalIds: [] },
      },
    },
    accepted,
  );
  if (!("ok" in answer)) throw new Error("offer not accepted");
});

afterAll(async () => {
  await close();
});

describe("maintenance contracts", () => {
  it("creates one contract per recurring interval of the accepted offer, once", async () => {
    expect(await asWanda((tx) => createContractsFromOffer(tx, actor, offerId))).toEqual({
      created: 2,
    });
    expect(await asWanda((tx) => createContractsFromOffer(tx, actor, offerId))).toEqual({
      error: "nothing_left",
    });
    const monthly = await contractByInterval("monthly");
    expect(monthly.title).toBe("Wartung monatlich: Website mit Betreuung");
    expect(monthly.startDate).toBe("2026-10-15");
    expect([monthly.minimumMonths, monthly.noticeMonths]).toEqual([12, 3]);
    // The offer's Gesamtrabatt applies to one-off lines only.
    expect(monthly.lines).toEqual([
      expect.objectContaining({ id: "care", unitPriceCents: 9_300, discountPercent: 0 }),
    ]);
    const list = await asWanda((tx) => listContracts(tx, ws, { offerId }, accepted));
    expect(list.map((entry) => [entry.interval, entry.state, entry.nextBilling])).toEqual([
      ["monthly", "active", "2026-10-15"],
      ["yearly", "active", "2026-10-15"],
    ]);
  });

  it("drafts the prorated first period with an approval task, and only once", async () => {
    expect(await runContractBilling(db, accepted)).toEqual({ drafted: 2, sent: 0, approvals: 2 });
    expect(await runContractBilling(db, accepted)).toEqual({ drafted: 0, sent: 0, approvals: 0 });
    const monthly = await contractByInterval("monthly");
    expect(monthly.billedUntil).toBe("2026-10-31");
    const [october] = await invoicesOf(monthly.id);
    expect(october!.status).toBe("draft");
    expect(october!.document.servicePeriod).toEqual({ from: "2026-10-15", to: "2026-10-31" });
    // 17 of 31 days of 93 €.
    expect(october!.document.lines[0]).toMatchObject({
      unitPriceCents: 5_100,
      description: "Anteilig: 17 von 31 Tagen",
    });
    const [task] = await approvalTasks(october!.id);
    expect(task!.title).toBe("Rechnung Wartung monatlich: Website mit Betreuung freigeben");
    const yearly = await contractByInterval("yearly");
    const [hosting] = await invoicesOf(yearly.id);
    expect(hosting!.document.servicePeriod).toEqual({ from: "2026-10-15", to: "2026-12-31" });
    expect(hosting!.document.lines[0]!.unitPriceCents).toBe(7_800);
  });

  it("keeps the start once billed and sends automatically only unchanged full periods", async () => {
    const monthly = await contractByInterval("monthly");
    expect(
      await asWanda((tx) =>
        saveContract(tx, actor, monthly.id, { startDate: "2026-11-01", sendMode: "auto" }),
      ),
    ).toMatchObject({ ok: false, error: "locked" });
    expect(
      await asWanda((tx) =>
        saveContract(tx, actor, monthly.id, { startDate: "2026-10-15", sendMode: "auto" }),
      ),
    ).toEqual({ ok: true });
    const [october] = await invoicesOf(monthly.id);
    expect((await asWanda((tx) => issueInvoice(tx, actor, october!.id, accepted))).ok).toBe(true);

    // November differs from the prorated October: it waits for approval, with the reason.
    const november = new Date("2026-11-01T08:00:00Z");
    expect(await runContractBilling(db, november)).toEqual({ drafted: 1, sent: 0, approvals: 1 });
    const [, novemberInvoice] = await invoicesOf(monthly.id);
    const [task] = await approvalTasks(novemberInvoice!.id);
    expect(task!.note).toMatch(/^Nicht automatisch gesendet: Die Positionen weichen/);
    expect((await asWanda((tx) => issueInvoice(tx, actor, novemberInvoice!.id, november))).ok).toBe(
      true,
    );

    // December equals November: issued, rendered on the server and sent without a look.
    send.mockClear();
    const december = new Date("2026-12-01T08:00:00Z");
    expect(await runContractBilling(db, december)).toEqual({ drafted: 1, sent: 1, approvals: 0 });
    const decemberInvoice = (await invoicesOf(monthly.id))[2]!;
    expect(decemberInvoice.status).toBe("issued");
    expect(decemberInvoice.number).toMatch(/^RE-2026-\d{4}$/);
    expect(await approvalTasks(decemberInvoice.id)).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]![0];
    expect(message.to).toBe("buchhaltung@gaertnerei.test");
    const attachment = message.attachments![0]!;
    expect(attachment.filename).toBe(`${decemberInvoice.number}.pdf`);
    const text = new TextDecoder("latin1").decode(attachment.content);
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text).toContain("factur-x.xml");
  });

  it("falls back to approval when the server cannot print the logo", async () => {
    await db
      .update(schema.workspaceSettings)
      .set({ branding: { logoAssetId: "00000000-0000-4000-8000-000000000000" } })
      .where(eq(schema.workspaceSettings.workspaceId, ws));
    const monthly = await contractByInterval("monthly");
    const [october] = await invoicesOf(monthly.id);
    expect(await asWanda((tx) => renderInvoicePdfOnServer(tx, ws, october!.id))).toEqual({
      ok: false,
      reason: "logo",
    });
    const january = new Date("2027-01-01T08:00:00Z");
    const result = await runContractBilling(db, january);
    expect(result).toMatchObject({ sent: 0 });
    const januaryInvoice = (await invoicesOf(monthly.id)).at(-1)!;
    expect(januaryInvoice.contractPeriodFrom).toBe("2027-01-01");
    // Issued already; the task asks to send it by hand.
    expect(januaryInvoice.status).toBe("issued");
    const [task] = await approvalTasks(januaryInvoice.id);
    expect(task!.note).toContain("Logo bitte unter Einstellungen → Marke neu hochladen");
    await db
      .update(schema.workspaceSettings)
      .set({ branding: {} })
      .where(eq(schema.workspaceSettings.workspaceId, ws));
  });

  it("ends after the notice period and the minimum term, prorating the last period", async () => {
    const monthly = await contractByInterval("monthly");
    expect(
      await asWanda((tx) =>
        setContractEnd(tx, actor, monthly.id, { noticeReceivedOn: "2027-01-10", endDate: null }),
      ),
    ).toEqual({ ok: true, endDate: "2027-10-14" });
    expect(
      await asWanda((tx) =>
        setContractEnd(tx, actor, monthly.id, {
          noticeReceivedOn: "2027-01-10",
          endDate: "2026-12-15",
        }),
      ),
    ).toMatchObject({ ok: false, error: "invalid" });
    // Catch up February to the end in one run (manual mode: drafts only).
    await asWanda((tx) =>
      saveContract(tx, actor, monthly.id, { startDate: "2026-10-15", sendMode: "manual" }),
    );
    const later = new Date("2027-12-01T08:00:00Z");
    expect(await runContractBilling(db, later)).toMatchObject({ drafted: 9, approvals: 0 });
    const last = (await invoicesOf(monthly.id)).at(-1)!;
    expect(last.document.servicePeriod).toEqual({ from: "2027-10-01", to: "2027-10-14" });
    expect(last.document.lines[0]!.unitPriceCents).toBe(4_200);
    const loaded = await asWanda((tx) => loadContract(tx, ws, monthly.id, later));
    expect(loaded!.state).toBe("ended");
    expect(loaded!.next).toBeNull();
  });

  it("bills nothing for a restricted customer", async () => {
    await db
      .update(schema.prospects)
      .set({ restrictedAt: new Date() })
      .where(eq(schema.prospects.id, prospectId));
    const yearly = await contractByInterval("yearly");
    expect(yearly.billedUntil).toBe("2027-12-31");
    await runContractBilling(db, new Date("2028-01-02T08:00:00Z"));
    expect((await contractByInterval("yearly")).billedUntil).toBe("2027-12-31");
  });
});
