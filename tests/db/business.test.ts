import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Period } from "@/domain/analytics/period";
import type { Actor } from "@/domain/authz";
import type { OfferDocument } from "@/domain/offers/schema";
import { getInfra } from "@/infra";
import { loadBusiness } from "@/server/analytics/business";
import { NO_FILTER } from "@/server/analytics/filters";
import { publishExpose } from "@/server/exposes/publish";
import { createContractsFromOffer } from "@/server/invoices/contracts";
import {
  addPayment,
  cancelInvoice,
  createInvoice,
  createInvoicesFromOffer,
  issueInvoice,
  saveInvoiceDraft,
} from "@/server/invoices/manage";
import { createOffer, saveOfferDraft, sendOffer } from "@/server/offers/manage";
import { answerOffer } from "@/server/offers/public";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** §7.10 phase 7c-5: the project dashboard's figures, filters and tenant isolation. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const bea = { id: "user-bea-business", email: "bea@geschaeft.test", name: "Bea" };
const otto = { id: "user-otto-business", email: "otto@geschaeft.test", name: "Otto" };
const sentAt = new Date("2026-10-05T08:00:00Z");
const october: Period = {
  from: new Date("2026-10-01T00:00:00Z"),
  to: new Date("2026-11-01T00:00:00Z"),
};
const later = new Date("2026-11-20T09:00:00Z");
let ws = "";
let otherWs = "";
let actor: Actor;
let campaignId = "";
let cafeOfferId = "";

vi.spyOn(getInfra().push, "send");
vi.spyOn(getInfra().email, "send");

const asBea = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: bea.id, workspaceId: ws }, fn);

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

const offer = (
  items: OfferDocument["items"],
  paymentPlan: OfferDocument["paymentPlan"] = [
    {
      id: "m1",
      title: "Bei Auftrag",
      share: { kind: "percent", value: 100 },
      trigger: "acceptance",
    },
  ],
): OfferDocument => ({
  title: "Neue Website",
  intro: undefined,
  outro: undefined,
  validDays: 30,
  discountPercent: 0,
  variants: [],
  items,
  paymentPlan,
  maintenance: {
    startOn: "acceptance",
    minimumMonths: 12,
    noticeMonths: 3,
    timing: "advance",
    indexed: false,
    includedMinutes: 0,
  },
});

async function customer(slug: string, name: string) {
  const published = await asBea((tx) =>
    publishExpose(
      tx,
      { workspaceId: ws, userId: bea.id, source: "api" },
      { document: minimalExpose(slug, name), assets: [] },
    ),
  );
  await db
    .update(schema.prospects)
    .set({ street: "Gasse 2", postalCode: "8010", city: "Graz", country: "AT" })
    .where(eq(schema.prospects.id, published.prospectId));
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.prospectId, published.prospectId));
  return { prospectId: published.prospectId, projectId: project!.id };
}

async function sent(projectId: string, document: OfferDocument, at = sentAt) {
  return asBea(async (tx) => {
    const id = (await createOffer(tx, actor, projectId))!;
    await saveOfferDraft(tx, actor, id, document);
    const result = await sendOffer(tx, actor, id, at);
    if (!result.ok) throw new Error(result.error);
    const [row] = await tx.select().from(schema.offers).where(eq(schema.offers.id, id));
    return { id, token: result.token, versionId: row!.currentVersionId! };
  });
}

const days = (n: number) => new Date(sentAt.getTime() + n * 86_400_000);

beforeAll(async () => {
  await db.insert(schema.users).values([bea, otto]);
  const created = await createWorkspace(db, {
    userId: bea.id,
    name: "Studio B",
    slug: "studio-geschaeft-b",
  });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  actor = { userId: bea.id, role: "owner", workspaceId: ws };
  const other = await createWorkspace(db, {
    userId: otto.id,
    name: "Studio O",
    slug: "studio-geschaeft-o",
  });
  if (!other.ok) throw new Error("workspace setup failed");
  otherWs = other.workspace.id;
  await db
    .update(schema.workspaceSettings)
    .set({
      senderAddress: {
        company: "Studio B",
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
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({ workspaceId: ws, name: "Cafés Graz" })
    .returning();
  campaignId = campaign!.id;

  // A café from the campaign accepts website plus monthly care two days after sending.
  const cafe = await customer("cafe-geschaeft", "Café Bohne");
  await db
    .update(schema.prospects)
    .set({ campaignId })
    .where(eq(schema.prospects.id, cafe.prospectId));
  const cafeOffer = await sent(
    cafe.projectId,
    offer([
      item({}),
      item({
        id: "care",
        title: "Wartung",
        unit: "Monat",
        unitPriceCents: 9_300,
        billing: "monthly",
      }),
    ]),
  );
  cafeOfferId = cafeOffer.id;
  const accepted = await answerOffer(
    db,
    {
      workspaceId: ws,
      token: cafeOffer.token,
      internal: false,
      body: {
        answer: "accept",
        versionId: cafeOffer.versionId,
        name: "Clara Bohne",
        confirmed: true,
        selection: { variantId: null, optionalIds: [] },
      },
    },
    days(2),
  );
  if (!("ok" in accepted)) throw new Error("offer not accepted");

  // A bakery without campaign declines one offer and leaves another open.
  const bakery = await customer("baeckerei-geschaeft", "Bäckerei Korn");
  const declined = await sent(bakery.projectId, offer([item({ unitPriceCents: 100_000 })]));
  const answer = await answerOffer(
    db,
    {
      workspaceId: ws,
      token: declined.token,
      internal: false,
      body: { answer: "decline", versionId: declined.versionId, reason: "Zu teuer" },
    },
    days(4),
  );
  if (!("ok" in answer)) throw new Error("offer not declined");
  await sent(bakery.projectId, offer([item({ unitPriceCents: 50_000 })]));

  // The café's invoice, partly paid; the bakery's invoice, issued and cancelled.
  const issuedOn = new Date("2026-10-10T09:00:00Z");
  await asBea(async (tx) => {
    await createInvoicesFromOffer(tx, actor, cafeOfferId, issuedOn);
    const [invoice] = await tx
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.offerId, cafeOfferId));
    const issued = await issueInvoice(tx, actor, invoice!.id, issuedOn);
    if (!issued.ok) throw new Error("cafe invoice not issued");
    await addPayment(tx, actor, invoice!.id, { amountCents: 100_000, paidOn: "2026-10-15" });
    await createContractsFromOffer(tx, actor, cafeOfferId);

    const draftId = (await createInvoice(tx, actor, { prospectId: bakery.prospectId }, issuedOn))!;
    const [draft] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, draftId));
    await saveInvoiceDraft(tx, actor, draftId, {
      ...draft!.document,
      title: "Beratung",
      lines: [
        {
          id: "beratung",
          title: "Beratung",
          description: undefined,
          quantity: 1,
          unit: "Pauschal",
          unitPriceCents: 80_000,
          discountPercent: 0,
          vatRate: 20,
        },
      ],
    });
    const second = await issueInvoice(tx, actor, draftId, issuedOn);
    if (!second.ok) throw new Error("bakery invoice not issued");
    const cancelled = await cancelInvoice(tx, actor, draftId, new Date("2026-10-20T09:00:00Z"));
    if (!cancelled.ok) throw new Error("bakery invoice not cancelled");
  });
});

afterAll(async () => {
  // The hourly jobs look across workspaces: leave nothing to bill or remind for other files.
  await db
    .update(schema.maintenanceContracts)
    .set({ endDate: sql`${schema.maintenanceContracts.startDate}` })
    .where(eq(schema.maintenanceContracts.workspaceId, ws));
  await db.update(schema.tasks).set({ doneAt: new Date() }).where(eq(schema.tasks.workspaceId, ws));
  await close();
});

describe("project dashboard", () => {
  it("values the offers sent and the answers given in the period", async () => {
    const data = await asBea((tx) =>
      loadBusiness(tx, ws, NO_FILTER, october, "Europe/Vienna", later),
    );
    // Accepted: 3.000 € + 12 × 93 €; declined 1.000 €; open 500 €.
    expect(data.offers).toEqual({
      sent: 3,
      volumeCents: 411_600 + 100_000 + 50_000,
      answered: 2,
      accepted: 1,
      rate: 0.5,
      avgDays: 2,
      viewed: 2,
      acceptedOfSent: 1,
    });
    expect(data.previousOffers).toMatchObject({ sent: 0, volumeCents: 0, answered: 0, rate: null });
  });

  it("counts issued revenue by campaign, a cancellation negative", async () => {
    const data = await asBea((tx) =>
      loadBusiness(tx, ws, NO_FILTER, october, "Europe/Vienna", later),
    );
    expect(data.revenue).toEqual({
      netCents: 300_000,
      invoices: 2,
      byCampaign: [
        { campaignId, name: "Cafés Graz", netCents: 300_000, invoices: 1 },
        { campaignId: null, name: "Ohne Kampagne", netCents: 0, invoices: 1 },
      ],
    });
    expect(data.previousRevenue.netCents).toBe(0);
  });

  it("shows today's open items and the running contracts' MRR", async () => {
    const data = await asBea((tx) =>
      loadBusiness(tx, ws, NO_FILTER, october, "Europe/Vienna", later),
    );
    // 3.600 € gross less 1.000 € paid; due on 24 October, so overdue on 20 November.
    expect(data.open).toMatchObject({ count: 1, openCents: 260_000, overdueCents: 260_000 });
    // Due on 24 October: 27 days overdue on 20 November.
    expect(data.open.aging.map((row) => [row.bucket, row.count, row.openCents])).toEqual([
      ["current", 0, 0],
      ["d30", 1, 260_000],
      ["d60", 0, 0],
      ["older", 0, 0],
    ]);
    expect(data.contracts).toEqual({ contracts: 1, mrrCents: 9_300 });
    const early = await asBea((tx) =>
      loadBusiness(tx, ws, NO_FILTER, october, "Europe/Vienna", new Date("2026-10-16T09:00:00Z")),
    );
    expect(early.open.overdueCents).toBe(0);
  });

  it("splits the twelve months up to the period into project and maintenance revenue", async () => {
    await asBea(async (tx) => {
      const [contract] = await tx
        .select()
        .from(schema.maintenanceContracts)
        .where(eq(schema.maintenanceContracts.workspaceId, ws));
      const draftId = (await createInvoice(
        tx,
        actor,
        { prospectId: contract!.prospectId },
        new Date("2026-10-12T09:00:00Z"),
      ))!;
      await tx
        .update(schema.invoices)
        .set({ contractId: contract!.id })
        .where(eq(schema.invoices.id, draftId));
      const [draft] = await tx
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, draftId));
      await saveInvoiceDraft(tx, actor, draftId, {
        ...draft!.document,
        title: "Wartung Oktober",
        lines: [
          {
            id: "care",
            title: "Wartung",
            description: undefined,
            quantity: 1,
            unit: "Monat",
            unitPriceCents: 9_300,
            discountPercent: 0,
            vatRate: 20,
          },
        ],
      });
      const issued = await issueInvoice(tx, actor, draftId, new Date("2026-10-12T09:00:00Z"));
      if (!issued.ok) throw new Error("maintenance invoice not issued");
    });
    const data = await asBea((tx) =>
      loadBusiness(tx, ws, NO_FILTER, october, "Europe/Vienna", later),
    );
    expect(data.byMonth).toHaveLength(12);
    expect(data.byMonth[0]!.month).toBe("2025-11");
    // The bakery's 800 € and its cancellation cancel out within October.
    expect(data.byMonth.at(-1)).toEqual({
      month: "2026-10",
      oneOffCents: 300_000,
      recurringCents: 9_300,
    });
    expect(data.revenue.netCents).toBe(309_300);
  });

  it("applies the campaign filter to every figure", async () => {
    const filter = { ...NO_FILTER, campaignId };
    const data = await asBea((tx) => loadBusiness(tx, ws, filter, october, "Europe/Vienna", later));
    expect(data.offers).toMatchObject({ sent: 1, volumeCents: 411_600, answered: 1, rate: 1 });
    expect(data.revenue.byCampaign.map((row) => row.name)).toEqual(["Cafés Graz"]);
    // Only the café has open items: the bakery's one invoice is cancelled.
    const all = await asBea((tx) =>
      loadBusiness(tx, ws, NO_FILTER, october, "Europe/Vienna", later),
    );
    expect(data.open.count).toBeGreaterThan(0);
    expect(data.open.count).toBe(all.open.count);
    expect(data.contracts.contracts).toBe(1);
    const none = await asBea((tx) =>
      loadBusiness(tx, ws, { ...NO_FILTER, industry: "Kfz" }, october, "Europe/Vienna", later),
    );
    expect([
      none.offers.sent,
      none.revenue.netCents,
      none.open.count,
      none.contracts.contracts,
    ]).toEqual([0, 0, 0, 0]);
  });

  it("shows another workspace nothing", async () => {
    const data = await withTenant(db, { userId: otto.id, workspaceId: otherWs }, (tx) =>
      loadBusiness(tx, ws, NO_FILTER, october, "Europe/Vienna", later),
    );
    expect(data.offers.sent).toBe(0);
    expect(data.revenue).toEqual({ netCents: 0, invoices: 0, byCampaign: [] });
    expect(data.open).toMatchObject({ count: 0, openCents: 0, overdueCents: 0 });
    expect(data.byMonth.every((row) => row.oneOffCents === 0 && row.recurringCents === 0)).toBe(
      true,
    );
    expect(data.contracts).toEqual({ contracts: 0, mrrCents: 0 });
  });

  it("counts deposit and final invoice once and narrows by region and tag", async () => {
    const workshop = await customer("tischlerei-geschaeft", "Tischlerei Span");
    await db
      .update(schema.prospects)
      .set({ postalCode: "4020", city: "Linz", tags: ["handwerk"] })
      .where(eq(schema.prospects.id, workshop.prospectId));
    const november = new Date("2026-11-02T08:00:00Z");
    const plan: OfferDocument["paymentPlan"] = [
      {
        id: "m1",
        title: "Anzahlung",
        share: { kind: "percent", value: 40 },
        trigger: "acceptance",
      },
      { id: "m2", title: "Go-live", share: { kind: "percent", value: 60 }, trigger: "milestone" },
    ];
    const workshopOffer = await sent(
      workshop.projectId,
      offer([item({ unitPriceCents: 200_000 })], plan),
      november,
    );
    const answer = await answerOffer(
      db,
      {
        workspaceId: ws,
        token: workshopOffer.token,
        internal: false,
        body: {
          answer: "accept",
          versionId: workshopOffer.versionId,
          name: "Sepp Span",
          confirmed: true,
          selection: { variantId: null, optionalIds: [] },
        },
      },
      november,
    );
    if (!("ok" in answer)) throw new Error("offer not accepted");
    await asBea(async (tx) => {
      await createInvoicesFromOffer(tx, actor, workshopOffer.id, november);
      const drafts = await tx
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.offerId, workshopOffer.id))
        .orderBy(schema.invoices.createdAt, schema.invoices.kind);
      for (const draft of drafts) {
        const issued = await issueInvoice(tx, actor, draft.id, november);
        if (!issued.ok) throw new Error(`${draft.kind} not issued`);
      }
    });
    const period: Period = {
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-12-01T00:00:00Z"),
    };
    for (const filter of [
      { ...NO_FILTER, region: "40" },
      { ...NO_FILTER, region: "linz" },
      { ...NO_FILTER, tag: "handwerk" },
    ]) {
      const data = await asBea((tx) =>
        loadBusiness(tx, ws, filter, period, "Europe/Vienna", later),
      );
      // 800 € deposit plus 2.000 € final less the 800 € deducted: 2.000 € once.
      expect(data.revenue).toMatchObject({ netCents: 200_000, invoices: 2 });
      expect(data.offers).toMatchObject({ sent: 1, accepted: 1, volumeCents: 200_000 });
      expect(data.contracts.contracts).toBe(0);
    }
  });

  it("leaves a restricted customer's contracts out of the MRR", async () => {
    await db
      .update(schema.prospects)
      .set({ restrictedAt: new Date() })
      .where(eq(schema.prospects.campaignId, campaignId));
    const data = await asBea((tx) =>
      loadBusiness(tx, ws, NO_FILTER, october, "Europe/Vienna", later),
    );
    expect(data.contracts).toEqual({ contracts: 0, mrrCents: 0 });
  });
});
