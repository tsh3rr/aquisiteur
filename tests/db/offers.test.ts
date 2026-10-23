import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
import type { ExposeDocument } from "@/domain/expose/schema";
import type { OfferDocument } from "@/domain/offers/schema";
import { getInfra } from "@/infra";
import { exportProspect } from "@/server/data-export";
import { publishExpose } from "@/server/exposes/publish";
import {
  createOffer,
  deleteOffer,
  loadOffer,
  saveOfferDraft,
  sendOffer,
  withdrawOffer,
} from "@/server/offers/manage";
import { exposesWithOfferPricing } from "@/server/offers/pricing";
import { answerOffer, loadPublicOffer, recordOfferView } from "@/server/offers/public";
import { createProject, deleteProject } from "@/server/projects";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** §7.10 projects and offers: numbering, versions, online acceptance, exposé prices. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const uma = { id: "user-uma", email: "uma@u.test", name: "Uma" };
let ws = "";
let actor: Actor;
let prospectId = "";
let projectId = "";

vi.spyOn(getInfra().push, "send");

const asUma = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: uma.id, workspaceId: ws }, fn);

const draft = (overrides: Partial<OfferDocument> = {}): OfferDocument => ({
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
    {
      id: "seo",
      title: "SEO-Paket",
      description: undefined,
      quantity: 1,
      unit: "Pauschal",
      unitPriceCents: 50_000,
      discountPercent: 0,
      vatRate: 20,
      billing: "once",
      optional: true,
      selected: false,
      variantIds: [],
    },
    {
      id: "wartung",
      title: "Wartung",
      description: undefined,
      quantity: 1,
      unit: "Monat",
      unitPriceCents: 4_900,
      discountPercent: 0,
      vatRate: 20,
      billing: "monthly",
      optional: false,
      selected: true,
      variantIds: [],
    },
  ],
  paymentPlan: [
    { id: "m1", title: "Anzahlung", share: { kind: "percent", value: 50 }, trigger: "acceptance" },
    { id: "m2", title: "Go-live", share: { kind: "percent", value: 50 }, trigger: "milestone" },
  ],
  maintenance: {
    startOn: "go_live",
    minimumMonths: 12,
    noticeMonths: 3,
    timing: "advance",
    indexed: false,
    includedMinutes: 0,
  },
  ...overrides,
});

async function newSentOffer() {
  return asUma(async (tx) => {
    const offerId = (await createOffer(tx, actor, projectId))!;
    await saveOfferDraft(tx, actor, offerId, draft());
    const sent = await sendOffer(tx, actor, offerId, new Date("2026-10-22T10:00:00Z"));
    if (!sent.ok) throw new Error(sent.error);
    return { offerId, ...sent };
  });
}

async function currentVersionId(offerId: string) {
  const [row] = await db
    .select({ id: schema.offers.currentVersionId })
    .from(schema.offers)
    .where(eq(schema.offers.id, offerId));
  return row!.id!;
}

beforeAll(async () => {
  await db.insert(schema.users).values([uma]);
  const created = await createWorkspace(db, {
    userId: uma.id,
    name: "Agentur U",
    slug: "agentur-angebot-u",
  });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  actor = { userId: uma.id, role: "owner", workspaceId: ws };
  const document = minimalExpose("baeckerei-uhl", "Bäckerei Uhl");
  const published = await asUma((tx) =>
    publishExpose(
      tx,
      { workspaceId: ws, userId: uma.id, source: "api" },
      {
        document: {
          ...document,
          blocks: [
            ...document.blocks,
            {
              id: "preise",
              type: "pricing",
              title: "Ihr Angebot",
              source: "offer",
              options: [{ id: "platzhalter", title: "Platzhalter", price: 1, billing: "once" }],
            },
          ],
        },
        assets: [],
      },
    ),
  );
  prospectId = published.prospectId;
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.prospectId, prospectId));
  projectId = project!.id;
});

afterAll(async () => {
  await close();
});

describe("projects", () => {
  it("puts the first exposé of a customer into an „Erstakquise“ project", async () => {
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    expect(project!.name).toBe("Erstakquise");
    const [expose] = await db
      .select({ projectId: schema.exposes.projectId })
      .from(schema.exposes)
      .where(eq(schema.exposes.prospectId, prospectId));
    expect(expose!.projectId).toBe(projectId);
  });

  it("keeps a project with an exposé and deletes an empty one", async () => {
    expect(await asUma((tx) => deleteProject(tx, actor, projectId))).toEqual({ error: "in_use" });
    const empty = await asUma((tx) =>
      createProject(tx, actor, prospectId, { name: "Onlineshop", description: null }),
    );
    expect(await asUma((tx) => deleteProject(tx, actor, empty!))).toEqual({ prospectId });
  });
});

describe("offers", () => {
  it("numbers offers per year and keeps the number across versions", async () => {
    const first = await newSentOffer();
    const second = await newSentOffer();
    expect(first.number).toBe("AN-2026-0001");
    expect(second.number).toBe("AN-2026-0002");
    expect(first.version).toBe(1);

    const again = await asUma(async (tx) => {
      await saveOfferDraft(
        tx,
        actor,
        first.offerId,
        draft({ title: "Neue Website, überarbeitet" }),
      );
      return sendOffer(tx, actor, first.offerId, new Date("2026-10-23T10:00:00Z"));
    });
    expect(again).toMatchObject({ ok: true, number: "AN-2026-0001", version: 2 });
    const loaded = await asUma((tx) => loadOffer(tx, ws, first.offerId));
    expect(loaded!.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(loaded!.versions[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded!.versions[0]!.sha256).not.toBe(loaded!.versions[1]!.sha256);
    expect(loaded!.versions[0]!.validUntil).toBe("2026-11-22");
    expect(loaded!.changedSinceSent).toBe(false);
    expect(loaded!.versions[0]!.taxMode).toBe("small_business");
  });

  it("deletes drafts only", async () => {
    const { offerId } = await newSentOffer();
    expect(await asUma((tx) => deleteOffer(tx, actor, offerId))).toBeNull();
    const draftId = await asUma((tx) => createOffer(tx, actor, projectId));
    expect(await asUma((tx) => deleteOffer(tx, actor, draftId!))).toEqual({ projectId });
  });

  it("counts the first real view once and ignores quiet ones", async () => {
    const { offerId } = await newSentOffer();
    await recordOfferView(db, { workspaceId: ws, offerId, quiet: true });
    await recordOfferView(db, { workspaceId: ws, offerId, quiet: false });
    await recordOfferView(db, { workspaceId: ws, offerId, quiet: false });
    const [row] = await db.select().from(schema.offers).where(eq(schema.offers.id, offerId));
    expect(row!.viewCount).toBe(2);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, "offer.viewed"), eq(schema.auditLog.targetId, offerId)),
      );
    expect(audits).toHaveLength(1);
  });

  it("accepts online with the chosen options and wins the customer", async () => {
    const { offerId, token } = await newSentOffer();
    const versionId = await currentVersionId(offerId);
    const outdated = await answerOffer(db, {
      workspaceId: ws,
      token,
      internal: false,
      body: {
        answer: "accept",
        versionId: crypto.randomUUID(),
        name: "Ute Uhl",
        confirmed: true,
        selection: { variantId: null, optionalIds: [] },
      },
    });
    expect(outdated).toEqual({ error: "outdated" });

    const unconfirmed = await answerOffer(db, {
      workspaceId: ws,
      token,
      internal: false,
      body: { answer: "accept", versionId, name: "Ute Uhl", selection: {} },
    });
    expect(unconfirmed).toMatchObject({ error: "invalid" });

    const accepted = await answerOffer(db, {
      workspaceId: ws,
      token,
      internal: false,
      body: {
        answer: "accept",
        versionId,
        name: "Ute Uhl",
        role: "Inhaberin",
        confirmed: true,
        selection: { variantId: null, optionalIds: ["seo", "unbekannt"] },
      },
    });
    expect(accepted).toEqual({ ok: true, status: "accepted" });

    const [offer] = await db.select().from(schema.offers).where(eq(schema.offers.id, offerId));
    expect(offer!.status).toBe("accepted");
    expect(offer!.acceptance).toMatchObject({
      name: "Ute Uhl",
      role: "Inhaberin",
      version: 1,
      optionalIds: ["seo"],
      onceTotalCents: 350_000,
      recurring: [{ interval: "monthly", totalCents: 4_900 }],
      taxMode: "small_business",
    });
    const [prospect] = await db
      .select({ status: schema.prospects.status })
      .from(schema.prospects)
      .where(eq(schema.prospects.id, prospectId));
    expect(prospect!.status).toBe("won");
    const [project] = await db
      .select({ status: schema.projects.status })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    expect(project!.status).toBe("ordered");
    const notifications = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.workspaceId, ws),
          eq(schema.notifications.trigger, "offer_answered"),
        ),
      );
    expect(notifications.map((entry) => entry.title)).toEqual([
      "Bäckerei Uhl · Angebot angenommen",
    ]);

    // A second answer and sending again are refused; the page shows it as accepted.
    expect(
      await answerOffer(db, {
        workspaceId: ws,
        token,
        internal: false,
        body: { answer: "decline", versionId },
      }),
    ).toEqual({ error: "closed" });
    expect(await asUma((tx) => sendOffer(tx, actor, offerId))).toMatchObject({ error: "locked" });
    const page = await loadPublicOffer(db, ws, token);
    expect(page!.status).toBe("accepted");
  });

  it("records a decline with its reason, and a withdrawn offer cannot be answered", async () => {
    const declined = await newSentOffer();
    const result = await answerOffer(db, {
      workspaceId: ws,
      token: declined.token,
      internal: false,
      body: {
        answer: "decline",
        versionId: await currentVersionId(declined.offerId),
        reason: "Zu teuer",
      },
    });
    expect(result).toEqual({ ok: true, status: "declined" });
    const [row] = await db
      .select()
      .from(schema.offers)
      .where(eq(schema.offers.id, declined.offerId));
    expect(row).toMatchObject({ status: "declined", declineReason: "Zu teuer" });

    const withdrawn = await newSentOffer();
    expect(await asUma((tx) => withdrawOffer(tx, actor, withdrawn.offerId))).toBe(true);
    expect(
      await answerOffer(db, {
        workspaceId: ws,
        token: withdrawn.token,
        internal: false,
        body: { answer: "decline", versionId: await currentVersionId(withdrawn.offerId) },
      }),
    ).toEqual({ error: "closed" });
  });

  it("treats a filled honeypot as success without changing anything", async () => {
    const { offerId, token } = await newSentOffer();
    const result = await answerOffer(db, {
      workspaceId: ws,
      token,
      internal: false,
      body: {
        answer: "decline",
        versionId: await currentVersionId(offerId),
        website: "https://spam.example",
      },
    });
    expect(result).toEqual({ ok: true, status: "declined" });
    const [row] = await db.select().from(schema.offers).where(eq(schema.offers.id, offerId));
    expect(row!.status).toBe("sent");
  });

  it("refuses an expired offer and a plan that does not add up", async () => {
    const { offerId, token } = await newSentOffer();
    const later = new Date("2026-12-01T10:00:00Z");
    expect((await loadPublicOffer(db, ws, token, later))!.status).toBe("expired");
    expect(
      await answerOffer(
        db,
        {
          workspaceId: ws,
          token,
          internal: false,
          body: { answer: "decline", versionId: await currentVersionId(offerId) },
        },
        later,
      ),
    ).toEqual({ error: "closed" });

    const overbooked = await asUma(async (tx) => {
      const id = (await createOffer(tx, actor, projectId))!;
      await saveOfferDraft(
        tx,
        actor,
        id,
        draft({
          paymentPlan: [
            {
              id: "m1",
              title: "Anzahlung",
              share: { kind: "amount", cents: 500_000 },
              trigger: "acceptance",
            },
            {
              id: "m2",
              title: "Rest",
              share: { kind: "percent", value: 100 },
              trigger: "milestone",
            },
          ],
        }),
      );
      return sendOffer(tx, actor, id);
    });
    expect(overbooked).toMatchObject({ ok: false, error: "invalid" });
  });

  it("exports offers, versions and their audit trail with the customer (Art. 15)", async () => {
    const { offerId } = await newSentOffer();
    const data = await asUma((tx) => exportProspect(tx, ws, prospectId));
    expect(data!.tables.projects!.length).toBeGreaterThan(0);
    expect(data!.tables.offers!.map((row) => row.id)).toContain(offerId);
    expect(data!.tables.offer_versions!.map((row) => row.offerId)).toContain(offerId);
    expect(
      data!.tables.audit_log!.some(
        (row) => row.action === "offer.sent" && row.targetId === offerId,
      ),
    ).toBe(true);
  });

  it("does not find an offer through another workspace's host", async () => {
    const { token } = await newSentOffer();
    expect(await loadPublicOffer(db, crypto.randomUUID(), token)).toBeNull();
  });

  it("fills a pricing block marked as offer-sourced when the exposé is published again", async () => {
    await newSentOffer();
    const document = minimalExpose("baeckerei-uhl", "Bäckerei Uhl");
    const result = await asUma((tx) =>
      publishExpose(
        tx,
        { workspaceId: ws, userId: uma.id, source: "api" },
        {
          document: {
            ...document,
            blocks: [
              ...document.blocks,
              {
                id: "preise",
                type: "pricing",
                title: "Ihr Angebot",
                source: "offer",
                options: [{ id: "platzhalter", title: "Platzhalter", price: 1, billing: "once" }],
              },
            ],
          },
          assets: [],
        },
      ),
    );
    const [version] = await db
      .select({ document: schema.exposeVersions.document })
      .from(schema.exposeVersions)
      .where(eq(schema.exposeVersions.id, result.versionId));
    const pricing = (version!.document as ExposeDocument).blocks.find(
      (block) => block.type === "pricing",
    );
    expect(
      pricing && "options" in pricing ? pricing.options.map((option) => option.title) : [],
    ).toEqual(["Website", "SEO-Paket", "Wartung"]);
  });

  it("fills the exposé's pricing block from the project's offer", async () => {
    const { offerId } = await newSentOffer();
    const documents = await asUma((tx) => exposesWithOfferPricing(tx, ws, offerId));
    expect(documents).toHaveLength(1);
    const pricing = (documents[0]!.document as ExposeDocument).blocks.find(
      (block) => block.type === "pricing",
    );
    expect(pricing).toMatchObject({ source: "offer" });
    expect(
      pricing && "options" in pricing ? pricing.options.map((option) => option.title) : [],
    ).toEqual(["Website", "SEO-Paket", "Wartung"]);
  });
});
