import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
import type { StoredPrintOptions } from "@/domain/letters/lifecycle";
import { previewImport } from "@/domain/prospects/import";
import { NO_FILTER } from "@/server/analytics/filters";
import { loadContent } from "@/server/analytics/content";
import { loadMapData } from "@/server/analytics/map";
import { loadActivity, loadFunnels, loadKpis } from "@/server/analytics/overview";
import {
  assignCampaign,
  createCampaign,
  deleteCampaign,
  listCampaigns,
  updateCampaign,
} from "@/server/campaigns";
import { publishExpose, type PublishResult } from "@/server/exposes/publish";
import {
  advanceLetters,
  createLetters,
  deleteDraftLetters,
  listLetters,
  loadPrintableLetters,
} from "@/server/letters/manage";
import { geocodePending } from "@/server/geocoding";
import { importProspects } from "@/server/prospects/import";
import { updateProspect } from "@/server/prospects/mutations";
import { ingestEvents, startVisit } from "@/server/tracking/visits";
import { createWorkspace } from "@/server/workspaces";
import type { GeocoderPort } from "@/infra";
import { allowStatistics } from "../support/consent";
import { minimalExpose } from "../support/expose";

/** Phase 5: campaigns, CSV import, letters and the dashboards' figures. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const lea = { id: "user-lea", email: "lea@l.test", name: "Lea" };
const max = { id: "user-max", email: "max@m.test", name: "Max" };
let wsL = "";
let wsM = "";
let cafe: PublishResult;
let bakery: PublishResult;
let actor: Actor;

const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DAY = 24 * 3600 * 1000;

const asLea = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: lea.id, workspaceId: wsL }, fn);

beforeAll(async () => {
  await db.insert(schema.users).values([lea, max]);
  const l = await createWorkspace(db, { userId: lea.id, name: "Agentur L", slug: "agentur-l" });
  const m = await createWorkspace(db, { userId: max.id, name: "Agentur M", slug: "agentur-m" });
  if (!l.ok || !m.ok) throw new Error("workspace setup failed");
  wsL = l.workspace.id;
  wsM = m.workspace.id;
  actor = { userId: lea.id, role: "owner", workspaceId: wsL };
  const publish = (key: string, company: string) =>
    asLea((tx) =>
      publishExpose(
        tx,
        { workspaceId: wsL, userId: lea.id, source: "api" },
        { document: minimalExpose(key, company), assets: [] },
      ),
    );
  cafe = await publish("cafe-mueller", "Café Müller");
  bakery = await publish("baeckerei-kern", "Bäckerei Kern");
  await db
    .update(schema.workspaceSettings)
    .set({
      senderAddress: {
        company: "Agentur L",
        street: "Hauptstr. 1",
        postalCode: "04109",
        city: "Leipzig",
      },
      profile: { displayName: "Lea Lang" },
    })
    .where(eq(schema.workspaceSettings.workspaceId, wsL));
  await db
    .update(schema.prospects)
    .set({ street: "Markt 1", postalCode: "04109", city: "Leipzig", industry: "Gastronomie" })
    .where(eq(schema.prospects.workspaceId, wsL));
});

afterAll(async () => {
  await close();
});

describe("campaigns and import", () => {
  let campaignId = "";

  it("creates, renames and assigns campaigns", async () => {
    campaignId = (await asLea((tx) =>
      createCampaign(tx, actor, { name: "Cafés Leipzig", description: null }),
    ))!;
    expect(campaignId).toBeTruthy();
    expect(
      await asLea((tx) => createCampaign(tx, actor, { name: "Cafés Leipzig", description: null })),
    ).toBeNull();
    expect(
      await asLea((tx) =>
        updateCampaign(tx, actor, campaignId, { name: "Cafés Leipzig Okt", description: "Test" }),
      ),
    ).toBe("ok");
    expect(
      await asLea((tx) =>
        assignCampaign(tx, actor, [cafe.prospectId, bakery.prospectId], campaignId),
      ),
    ).toBe(2);
    const [campaign] = await asLea((tx) => listCampaigns(tx, wsL));
    expect(campaign).toMatchObject({ name: "Cafés Leipzig Okt", prospects: 2 });
  });

  it("imports a CSV, skipping companies it already knows", async () => {
    const preview = previewImport(
      [
        "Firma;Straße;PLZ;Ort;Vorname;Nachname;Anrede",
        "Café Müller;Markt 1;04109;Leipzig;;;",
        "Blumen Rose;Ring 5;04103;Leipzig;Rosa;Blum;Frau",
        "Blumen Rose;Ring 5;04103;Leipzig;;;",
      ].join("\n"),
    );
    const result = await asLea((tx) => importProspects(tx, actor, preview.rows, campaignId));
    expect(result.created).toBe(1);
    expect(result.duplicates.map((d) => d.line)).toEqual([2, 4]);
    const [rose] = await asLea((tx) =>
      tx.select().from(schema.prospects).where(eq(schema.prospects.companyName, "Blumen Rose")),
    );
    expect(rose).toMatchObject({ campaignId, city: "Leipzig" });
    const people = await asLea((tx) =>
      tx.select().from(schema.contacts).where(eq(schema.contacts.prospectId, rose!.id)),
    );
    expect(people).toMatchObject([{ salutation: "Frau", lastName: "Blum", isPrimary: true }]);
  });

  it("deleting a campaign keeps its prospects", async () => {
    const temp = (await asLea((tx) =>
      createCampaign(tx, actor, { name: "Weg", description: null }),
    ))!;
    await asLea((tx) => assignCampaign(tx, actor, [bakery.prospectId], temp));
    expect(await asLea((tx) => deleteCampaign(tx, actor, temp))).toBe(true);
    const [row] = await asLea((tx) =>
      tx.select().from(schema.prospects).where(eq(schema.prospects.id, bakery.prospectId)),
    );
    expect(row!.campaignId).toBeNull();
    await asLea((tx) => assignCampaign(tx, actor, [bakery.prospectId], campaignId));
  });

  it("other workspaces see none of it", async () => {
    const rows = await withTenant(db, { userId: max.id, workspaceId: wsM }, (tx) =>
      tx.select().from(schema.campaigns),
    );
    expect(rows).toEqual([]);
  });
});

describe("letters", () => {
  let cafeLetter = "";

  it("creates drafts with the exposé's touchpoint, skips prospects without exposé", async () => {
    const [rose] = await asLea((tx) =>
      tx.select().from(schema.prospects).where(eq(schema.prospects.companyName, "Blumen Rose")),
    );
    const result = await asLea((tx) =>
      createLetters(tx, actor, {
        prospectIds: [cafe.prospectId, bakery.prospectId, rose!.id],
        kind: "initial",
      }),
    );
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toMatchObject([{ companyName: "Blumen Rose", reason: "no_expose" }]);
    const again = await asLea((tx) =>
      createLetters(tx, actor, { prospectIds: [cafe.prospectId], kind: "initial" }),
    );
    expect(again.skipped[0]!.reason).toBe("has_letter");
    const letters = await asLea((tx) => listLetters(tx, wsL, { prospectId: cafe.prospectId }));
    expect(letters).toMatchObject([
      { status: "draft", kind: "initial", campaignId: expect.any(String) },
    ]);
    expect(letters[0]!.shortCode).toBeTruthy();
    cafeLetter = letters[0]!.id;
  });

  it("composes the printable letter", async () => {
    const [printable] = await asLea((tx) => loadPrintableLetters(tx, wsL, [cafeLetter]));
    expect(printable).toMatchObject({
      companyName: "Café Müller",
      returnAddress: "Agentur L · Hauptstr. 1 · 04109 Leipzig",
      salutation: "Guten Tag Muster,",
      problems: [],
    });
    expect(printable!.address).toEqual(["Café Müller", "Muster", "Markt 1", "04109 Leipzig"]);
    expect(printable!.qr.shortLink).toMatch(/^agentur-l\.localhost:3000\/[a-z0-9]+$/);
    expect(printable!.qrModules.path).toMatch(/^M\d/);
    // Teaser page from the current exposé version (ADR-0055), on unless the letter says otherwise.
    expect(printable!.teaser).toMatchObject({ headline: "Hallo Café Müller", ideas: [] });
    // The dotted code encodes the same link as the classic one.
    expect(printable!.teaser!.qr.bits).toHaveLength(printable!.teaser!.qr.size ** 2);

    const legacy: StoredPrintOptions = {
      color: false,
      duplex: false,
      shipping: "standard",
      envelope: "DL",
      inserts: [],
    };
    const setOptions = (options: StoredPrintOptions) =>
      asLea((tx) =>
        tx.update(schema.letters).set({ options }).where(eq(schema.letters.id, cafeLetter)),
      );
    // Letters from before the teaser page have no `teaser` and print with it.
    await setOptions(legacy);
    const [old] = await asLea((tx) => loadPrintableLetters(tx, wsL, [cafeLetter]));
    expect(old!.teaser).not.toBeNull();
    await setOptions({ ...legacy, teaser: false });
    const [plain] = await asLea((tx) => loadPrintableLetters(tx, wsL, [cafeLetter]));
    expect(plain!.teaser).toBeNull();
    // Phone and e-mail in the call to action can be left out per letter.
    await setOptions({ ...legacy, contact: false });
    const [quiet] = await asLea((tx) => loadPrintableLetters(tx, wsL, [cafeLetter]));
    expect(quiet!.teaser!.contact).toBeNull();
    expect(quiet!.senderLogo).toBeNull();
    await setOptions({ ...legacy, teaser: true });
  });

  it("marking as posted walks the lifecycle and sets the prospect's status", async () => {
    const postedAt = new Date(Date.now() - 3 * DAY);
    const all = await asLea((tx) => listLetters(tx, wsL));
    const result = await asLea((tx) =>
      advanceLetters(
        tx,
        actor,
        all.map((letter) => letter.id),
        "posted",
        postedAt,
      ),
    );
    expect(result).toEqual({ changed: 2, refused: 0 });
    const [letter] = await asLea((tx) =>
      tx.select().from(schema.letters).where(eq(schema.letters.id, cafeLetter)),
    );
    expect(letter).toMatchObject({
      status: "posted",
      providerRef: `manual-${cafeLetter}`,
      costCents: 110,
      postedAt,
      queuedAt: postedAt,
      submittedAt: postedAt,
      printedAt: postedAt,
    });
    const [prospect] = await asLea((tx) =>
      tx.select().from(schema.prospects).where(eq(schema.prospects.id, cafe.prospectId)),
    );
    expect(prospect!.status).toBe("letter_sent");
    const usage = await asLea((tx) =>
      tx.select().from(schema.usageEvents).where(eq(schema.usageEvents.kind, "letter")),
    );
    expect(usage).toHaveLength(2);
    // Posted letters cannot be cancelled or posted again.
    expect(await asLea((tx) => advanceLetters(tx, actor, [cafeLetter], "cancelled"))).toEqual({
      changed: 0,
      refused: 1,
    });
  });

  it("a follow-up gets its own code; drafts can be discarded", async () => {
    const { created } = await asLea((tx) =>
      createLetters(tx, actor, { prospectIds: [cafe.prospectId], kind: "follow_up" }),
    );
    const [followUp] = await asLea((tx) => listLetters(tx, wsL, { ids: created }));
    const [initial] = await asLea((tx) => listLetters(tx, wsL, { ids: [cafeLetter] }));
    expect(followUp!.shortCode).not.toBe(initial!.shortCode);
    expect(await asLea((tx) => deleteDraftLetters(tx, actor, created))).toBe(1);
    const [touchpoint] = await asLea((tx) =>
      tx
        .select()
        .from(schema.touchpoints)
        .where(
          and(
            eq(schema.touchpoints.prospectId, cafe.prospectId),
            eq(schema.touchpoints.label, "Folgebrief"),
          ),
        ),
    );
    expect(touchpoint!.disabledAt).not.toBeNull();
  });
});

describe("dashboards", () => {
  const period = { from: new Date(Date.now() - 30 * DAY), to: new Date(Date.now() + DAY) };

  beforeAll(async () => {
    // Café Müller opens the exposé, reads the pricing and taps "WhatsApp".
    const started = await startVisit(db, {
      workspaceId: wsL,
      body: { slug: cafe.slug, viewport: { width: 390, height: 844 } },
      headers: new Headers({ "user-agent": PHONE }),
      internal: false,
    });
    if (!("token" in started)) throw new Error("visit failed");
    await allowStatistics(db, wsL, started.token);
    // Started an hour ago, so the events' times are not clamped to "now".
    const hourAgo = new Date(Date.now() - 3600 * 1000);
    await db
      .update(schema.visits)
      .set({ startedAt: hourAgo, confirmedAt: hourAgo })
      .where(eq(schema.visits.prospectId, cafe.prospectId));
    const events = [
      { type: "page_view", at: 0 },
      { type: "section_view", at: 1000, blockId: "start", blockType: "hero" },
      { type: "section_dwell", at: 9000, blockId: "start", blockType: "hero", seconds: 8 },
      { type: "section_view", at: 10_000, blockId: "kontakt", blockType: "contact" },
      { type: "cta_hover", at: 11_000, channel: "whatsapp" },
      { type: "contact_click", at: 12_000, channel: "whatsapp" },
      { type: "nudge_shown", at: 13_000, nudge: "read_invite" },
      { type: "heartbeat", at: 60_000, seconds: 60 },
      { type: "heartbeat", at: 120_000, seconds: 60 },
      { type: "heartbeat", at: 150_000, seconds: 30 },
    ];
    expect(
      await ingestEvents(db, { workspaceId: wsL, body: { token: started.token, events } }),
    ).toBe("ok");
    await db
      .update(schema.prospects)
      .set({ estimatedValueCents: 250_000 })
      .where(eq(schema.prospects.id, cafe.prospectId));
  });

  it("computes the overview figures with the previous period", async () => {
    const { current, previous, pipelineCents } = await asLea((tx) =>
      loadKpis(tx, wsL, NO_FILTER, period),
    );
    expect(current).toMatchObject({
      lettersSent: 2,
      opened: 1,
      openRate: 0.5,
      visits: 1,
      visitedProspects: 1,
      contactAttempts: 1,
      contactRate: 1,
      costCents: 220,
      costPerLetterCents: 110,
      costPerWinCents: null,
    });
    expect(current.avgHoursToOpen).toBeGreaterThan(70);
    expect(current.avgReadSeconds).toBe(150);
    expect(previous.lettersSent).toBe(0);
    // The café is "opened" now; only interested/contacted/meeting count as pipeline.
    expect(pipelineCents).toBe(0);
  });

  it("builds the funnel per campaign", async () => {
    const { all, campaigns } = await asLea((tx) => loadFunnels(tx, wsL, NO_FILTER, period));
    expect(all.map((row) => row.count)).toEqual([2, 1, 1, 1, 0, 0, 0]);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]!.name).toBe("Cafés Leipzig Okt");
  });

  it("filters by industry and region", async () => {
    const none = await asLea((tx) =>
      loadKpis(tx, wsL, { ...NO_FILTER, industry: "Handwerk" }, period),
    );
    expect(none.current.lettersSent).toBe(0);
    const leipzig = await asLea((tx) => loadKpis(tx, wsL, { ...NO_FILTER, region: "041" }, period));
    expect(leipzig.current.lettersSent).toBe(2);
  });

  it("knows when and what prospects read", async () => {
    const activity = await asLea((tx) => loadActivity(tx, wsL, NO_FILTER, period, "Europe/Berlin"));
    expect(activity.days.reduce((sum, day) => sum + day.visits, 0)).toBe(1);
    expect(activity.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(1);
    const content = await asLea((tx) => loadContent(tx, wsL, NO_FILTER, period));
    expect(content).toMatchObject({ visits: 1, contactViews: 1 });
    expect(content.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockType: "hero", views: 1, avgSeconds: 8, exits: 0 }),
        expect.objectContaining({ blockType: "contact", views: 1, exits: 1, exitRate: 1 }),
      ]),
    );
    expect(content.channels).toEqual([{ channel: "whatsapp", hovers: 1, clicks: 1, rate: 1 }]);
    expect(content.nudges).toEqual([
      { nudge: "read_invite", shown: 1, clicked: 0, dismissed: 0, clickRate: 0 },
    ]);
  });

  it("another workspace's dashboards stay empty", async () => {
    const other = await withTenant(db, { userId: max.id, workspaceId: wsM }, (tx) =>
      loadKpis(tx, wsM, NO_FILTER, period),
    );
    expect(other.current).toMatchObject({ lettersSent: 0, visits: 0 });
  });
});

describe("map", () => {
  it("geocodes once, stores misses and re-queues edited addresses", async () => {
    // Same behaviour as the `fake` adapter: "Unbekannt" is never found.
    const geocoder: GeocoderPort = {
      id: "test",
      minIntervalMs: 0,
      geocode: async (query) =>
        query.city === "Unbekannt"
          ? null
          : { latitude: 51.3 + (query.street?.length ?? 0) / 100, longitude: 12.37 },
    };
    await db
      .update(schema.prospects)
      .set({ city: "Unbekannt", postalCode: null, street: null })
      .where(eq(schema.prospects.id, bakery.prospectId));
    const first = await geocodePending(db, { geocoder, limit: 500 });
    expect(first.failed).toBe(false);
    expect(first.found).toBeGreaterThan(0);
    expect(first.missed).toBeGreaterThanOrEqual(1);
    expect(await geocodePending(db, { geocoder })).toEqual({ found: 0, missed: 0, failed: false });

    let map = await asLea((tx) => loadMapData(tx, wsL, NO_FILTER));
    expect(map.points.map((point) => point.id)).toContain(cafe.prospectId);
    expect(map.points.map((point) => point.id)).not.toContain(bakery.prospectId);
    expect(map.notFound).toBeGreaterThanOrEqual(1);
    expect(map.pending).toBe(0);

    // Fixing the address queues it again; other edits keep the position.
    await asLea(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.prospects)
        .where(eq(schema.prospects.id, bakery.prospectId));
      await updateProspect(tx, actor, bakery.prospectId, {
        companyName: row!.companyName,
        industry: row!.industry,
        website: row!.website,
        street: "Markt 2",
        postalCode: "04109",
        city: "Leipzig",
        phone: row!.phone,
        email: row!.email,
        tags: row!.tags,
        notes: row!.notes,
        estimatedValue: null,
        campaignId: row!.campaignId,
      } as Parameters<typeof updateProspect>[3]);
    });
    map = await asLea((tx) => loadMapData(tx, wsL, NO_FILTER));
    expect(map.pending).toBe(1);
    await geocodePending(db, { geocoder });
    map = await asLea((tx) => loadMapData(tx, wsL, NO_FILTER));
    expect(map.points.map((point) => point.id)).toContain(bakery.prospectId);

    const before = map.points.find((point) => point.id === cafe.prospectId)!;
    await asLea(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.prospects)
        .where(eq(schema.prospects.id, cafe.prospectId));
      await updateProspect(tx, actor, cafe.prospectId, {
        companyName: "Café Müller & Söhne",
        industry: row!.industry,
        website: row!.website,
        street: row!.street,
        postalCode: row!.postalCode,
        city: row!.city,
        phone: row!.phone,
        email: row!.email,
        tags: row!.tags,
        notes: row!.notes,
        estimatedValue: null,
        campaignId: row!.campaignId,
      } as Parameters<typeof updateProspect>[3]);
    });
    map = await asLea((tx) => loadMapData(tx, wsL, NO_FILTER));
    expect(map.points.find((point) => point.id === cafe.prospectId)?.latitude).toBe(
      before.latitude,
    );

    const other = await withTenant(db, { userId: max.id, workspaceId: wsM }, (tx) =>
      loadMapData(tx, wsM, NO_FILTER),
    );
    expect(other.points).toEqual([]);
  });
});
