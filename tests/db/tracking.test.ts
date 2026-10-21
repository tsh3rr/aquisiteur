import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "@/db/client";
import * as schema from "@/db/schema";
import { parseListQuery } from "@/domain/prospects/list-query";
import { publishExpose, type PublishResult } from "@/server/exposes/publish";
import { listProspects } from "@/server/prospects/list";
import { setProspectStatus } from "@/server/prospects/mutations";
import { hitRateLimit } from "@/server/tracking/rate-limit";
import { recordConsent } from "@/server/tracking/replay";
import { CONSENT_NOTICE_VERSION } from "@/domain/tracking/consent";
import {
  createVisit,
  ingestEvents,
  resolveCode,
  shareLinkForVisit,
  shortCodeSuggestions,
  startVisit,
  ticketForVisit,
} from "@/server/tracking/visits";
import { createWorkspace } from "@/server/workspaces";
import { allowStatistics } from "../support/consent";
import { minimalExpose } from "../support/expose";

/**
 * Phase 2 "done when": a scan shows up in the timeline, bots are ignored.
 * Runs the public tracking flow on the system connection, the way the
 * resolver and ingestion routes do.
 */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const fritz = { id: "user-fritz", email: "fritz@f.test", name: "Fritz" };
const gina = { id: "user-gina", email: "gina@g.test", name: "Gina" };
let wsF = "";
let wsG = "";
let cafe: PublishResult;
let foreign: PublishResult;

const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const headers = (ua: string, extra: Record<string, string> = {}) =>
  new Headers({ "user-agent": ua, "cf-ipcity": "Leipzig", "cf-ipcountry": "DE", ...extra });

function publish(userId: string, workspaceId: string, key: string, company: string) {
  return withTenant(db, { userId, workspaceId }, (tx) =>
    publishExpose(
      tx,
      { workspaceId, userId, source: "api" },
      {
        document: minimalExpose(key, company),
        assets: [],
      },
    ),
  );
}

async function prospectStatus(id: string) {
  const [row] = await db.select().from(schema.prospects).where(eq(schema.prospects.id, id));
  return row!.status;
}

/** What the resolver route does, followed by the exposé script reporting in. */
async function scan(code: string, ua: string, internal = false) {
  const hit = await resolveCode(db, wsF, code);
  if (!hit) throw new Error(`no touchpoint for ${code}`);
  const visit = await createVisit(db, {
    workspaceId: wsF,
    prospectId: hit.prospectId,
    exposeId: hit.exposeId,
    touchpointId: hit.touchpointId,
    source: hit.source,
    headers: headers(ua),
    internal,
  });
  const started = await startVisit(db, {
    workspaceId: wsF,
    body: {
      slug: hit.slug,
      ticket: await ticketForVisit(visit.id),
      viewport: { width: 390, height: 844 },
    },
    headers: headers(ua),
    internal,
  });
  if (!("token" in started)) throw new Error(`start failed: ${started.error}`);
  return { visitId: visit.id, token: started.token, hit };
}

beforeAll(async () => {
  await db.insert(schema.users).values([fritz, gina]);
  const f = await createWorkspace(db, { userId: fritz.id, name: "Agentur F", slug: "agentur-f" });
  const g = await createWorkspace(db, { userId: gina.id, name: "Agentur G", slug: "agentur-g" });
  if (!f.ok || !g.ok) throw new Error("workspace setup failed");
  wsF = f.workspace.id;
  wsG = g.workspace.id;
  cafe = await publish(fritz.id, wsF, "cafe-mueller", "Café Müller");
  foreign = await publish(gina.id, wsG, "cafe-mueller", "Café Müller");
});

afterAll(async () => {
  await close();
});

describe("short links", () => {
  it("publishing creates one letter touchpoint with QR token and short code", async () => {
    expect(cafe.letter.qrToken).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(cafe.letter.shortCode).toMatch(/^[a-z2-9]{4}$/);
    const again = await publish(fritz.id, wsF, "cafe-mueller", "Café Müller");
    expect(again.letter).toEqual(cafe.letter);
  });

  it("resolves QR tokens exactly and short codes case-insensitively, per workspace", async () => {
    expect(await resolveCode(db, wsF, cafe.letter.qrToken)).toMatchObject({
      source: "qr",
      slug: cafe.slug,
    });
    expect(await resolveCode(db, wsF, cafe.letter.shortCode!.toUpperCase())).toMatchObject({
      source: "typed",
    });
    expect(await resolveCode(db, wsF, cafe.letter.qrToken.toLowerCase())).toBeNull();
    expect(await resolveCode(db, wsF, foreign.letter.qrToken)).toBeNull();
    expect(await resolveCode(db, wsG, cafe.letter.shortCode!)).toBeNull();
  });

  it("suggests the short code for a typo, never a QR token", async () => {
    const code = cafe.letter.shortCode!;
    const typo = `${code.slice(0, 3)}${code[3] === "z" ? "y" : "z"}`;
    expect(await shortCodeSuggestions(db, wsF, typo)).toContain(code);
    expect(await shortCodeSuggestions(db, wsF, cafe.letter.qrToken.slice(0, 11))).toEqual([]);
  });
});

describe("visits", () => {
  it("ignores link previews: recorded as bot, status unchanged", async () => {
    await scan(cafe.letter.qrToken, "WhatsApp/2.23.20.0 A");
    expect(await prospectStatus(cafe.prospectId)).toBe("draft");
    const [bot] = await db
      .select()
      .from(schema.visits)
      .where(and(eq(schema.visits.workspaceId, wsF), eq(schema.visits.isBot, true)));
    expect(bot).toMatchObject({ botReason: "WhatsApp-Vorschau", source: "qr" });
  });

  it("ignores the owner's own device", async () => {
    await scan(cafe.letter.qrToken, PHONE, true);
    expect(await prospectStatus(cafe.prospectId)).toBe("draft");
  });

  it("a real scan confirms the visit, records events and opens the prospect", async () => {
    const { visitId, token } = await scan(cafe.letter.qrToken, PHONE);
    expect(await prospectStatus(cafe.prospectId)).toBe("opened");
    await allowStatistics(db, wsF, token);

    const result = await ingestEvents(db, {
      workspaceId: wsF,
      body: {
        token,
        events: [
          { type: "heartbeat", at: 15_000, seconds: 15 },
          { type: "section_dwell", at: 12_000, blockId: "start", seconds: 9 },
          { type: "scroll_depth", at: 13_000, percent: 75 },
          { type: "contact_click", at: 14_000, channel: "whatsapp" },
          { type: "made_up", at: 1 },
        ],
      },
    });
    expect(result).toBe("ok");
    const [visit] = await db.select().from(schema.visits).where(eq(schema.visits.id, visitId));
    expect(visit).toMatchObject({
      isBot: false,
      isInternal: false,
      city: "Leipzig",
      device: "mobile",
      activeSeconds: 15,
      maxScroll: 75,
    });
    expect(visit!.confirmedAt).not.toBeNull();
    const types = await db
      .select({ type: schema.events.type, payload: schema.events.payload })
      .from(schema.events)
      .where(eq(schema.events.visitId, visitId));
    expect(types.map((row) => row.type).sort()).toEqual([
      "consent_given",
      "contact_click",
      "page_view",
      "scroll_depth",
      "section_dwell",
    ]);
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.workspaceId, wsF),
          eq(schema.auditLog.action, "prospect.status_changed"),
        ),
      );
    expect(audit!.meta).toMatchObject({ from: "draft", to: "opened", via: "visit" });
  });

  it("a ticket confirms its visit only once and only for its exposé", async () => {
    const hit = (await resolveCode(db, wsF, cafe.letter.qrToken))!;
    const visit = await createVisit(db, {
      workspaceId: wsF,
      prospectId: hit.prospectId,
      exposeId: hit.exposeId,
      touchpointId: hit.touchpointId,
      source: "qr",
      headers: headers(PHONE),
      internal: false,
    });
    const ticket = await ticketForVisit(visit.id);
    const body = { slug: hit.slug, ticket };
    await startVisit(db, { workspaceId: wsF, body, headers: headers(PHONE), internal: false });
    const before = await db.$count(schema.visits, eq(schema.visits.workspaceId, wsF));
    // Reuse becomes a fresh direct visit rather than re-attributing.
    await startVisit(db, { workspaceId: wsF, body, headers: headers(PHONE), internal: false });
    expect(await db.$count(schema.visits, eq(schema.visits.workspaceId, wsF))).toBe(before + 1);
    // A ticket from workspace F is useless on workspace G.
    expect(
      await startVisit(db, { workspaceId: wsG, body, headers: headers(PHONE), internal: false }),
    ).toEqual({ error: "not_found" });
  });

  it("rejects forged visit tokens and tokens from another workspace", async () => {
    const { token } = await scan(cafe.letter.shortCode!, PHONE);
    const events = [{ type: "share", at: 1 }];
    expect(await ingestEvents(db, { workspaceId: wsG, body: { token, events } })).toBe("invalid");
    expect(
      await ingestEvents(db, {
        workspaceId: wsF,
        body: { token: `${token.slice(0, -2)}xx`, events },
      }),
    ).toBe("invalid");
  });

  it("sharing creates one forwarded link per visit, attributed as share", async () => {
    const { visitId, token } = await scan(cafe.letter.qrToken, PHONE);
    const first = await shareLinkForVisit(db, { workspaceId: wsF, token });
    const second = await shareLinkForVisit(db, { workspaceId: wsF, token });
    expect(first).toEqual(second);
    if (typeof first === "string") throw new Error(first);
    expect(await resolveCode(db, wsF, first.qrToken)).toMatchObject({ source: "share" });
    const [link] = await db
      .select()
      .from(schema.touchpoints)
      .where(eq(schema.touchpoints.qrToken, first.qrToken));
    expect(link).toMatchObject({ channel: "share", parentVisitId: visitId, shortCode: null });
  });

  it("rate-limits per key and window", async () => {
    expect(await hitRateLimit(db, "test:x", 2, 60)).toBe(true);
    expect(await hitRateLimit(db, "test:x", 2, 60)).toBe(true);
    expect(await hitRateLimit(db, "test:x", 2, 60)).toBe(false);
    expect(await hitRateLimit(db, "test:x", 2, 60, Date.now() + 61_000)).toBe(true);
  });
});

describe("customer list", () => {
  it("filters by status and activity and counts only real visits", async () => {
    const actor = { userId: fritz.id, role: "owner" as const, workspaceId: wsF };
    await publish(fritz.id, wsF, "tischlerei", "Tischlerei Holz");
    const rows = await withTenant(db, { userId: fritz.id, workspaceId: wsF }, (tx) =>
      listProspects(tx, wsF, parseListQuery({})),
    );
    expect(rows.map((row) => row.companyName)).toEqual(["Café Müller", "Tischlerei Holz"]);
    const cafeRow = rows[0]!;
    // Bot and owner visits are left out; four real scans above.
    expect(cafeRow.visitCount).toBe(5);
    expect(cafeRow.lastActivityAt).toBeInstanceOf(Date);

    const never = await withTenant(db, { userId: fritz.id, workspaceId: wsF }, (tx) =>
      listProspects(tx, wsF, parseListQuery({ aktiv: "never" })),
    );
    expect(never.map((row) => row.companyName)).toEqual(["Tischlerei Holz"]);

    const changed = await withTenant(db, { userId: fritz.id, workspaceId: wsF }, (tx) =>
      setProspectStatus(
        tx,
        actor,
        rows.map((row) => row.id),
        "letter_sent",
      ),
    );
    expect(changed).toBe(2);
    const sent = await withTenant(db, { userId: fritz.id, workspaceId: wsF }, (tx) =>
      listProspects(tx, wsF, parseListQuery({ status: "letter_sent", q: "café" })),
    );
    expect(sent.map((row) => row.companyName)).toEqual(["Café Müller"]);
  });

  it("cannot change prospects of another workspace", async () => {
    const actor = { userId: fritz.id, role: "owner" as const, workspaceId: wsF };
    const changed = await withTenant(db, { userId: fritz.id, workspaceId: wsF }, (tx) =>
      setProspectStatus(tx, actor, [foreign.prospectId], "won"),
    );
    expect(changed).toBe(0);
    expect(await prospectStatus(foreign.prospectId)).toBe("draft");
  });
});

describe("consent (ADR-0065)", () => {
  it("without consent keeps only the basis, the script's reading statistics are dropped", async () => {
    const { visitId, token } = await scan(cafe.letter.qrToken, PHONE);
    const reading = [
      { type: "heartbeat", at: 15_000, seconds: 15 },
      { type: "section_view", at: 1_000, blockId: "start" },
      { type: "scroll_depth", at: 13_000, percent: 50 },
      { type: "cta_hover", at: 14_000, channel: "whatsapp" },
      { type: "share", at: 16_000 },
    ];
    expect(await ingestEvents(db, { workspaceId: wsF, body: { token, events: reading } })).toBe(
      "ok",
    );
    const stored = async () =>
      (
        await db
          .select({ type: schema.events.type })
          .from(schema.events)
          .where(eq(schema.events.visitId, visitId))
      )
        .map((row) => row.type)
        .sort();
    expect(await stored()).toEqual(["page_view", "share"]);
    const [visit] = await db.select().from(schema.visits).where(eq(schema.visits.id, visitId));
    expect(visit).toMatchObject({ activeSeconds: 0, maxScroll: 0, city: "Leipzig" });

    // „Ablehnen“ is stored as proof and changes nothing.
    const answer = (decision: "given" | "denied" | "withdrawn") =>
      recordConsent(db, {
        workspaceId: wsF,
        body: { token, scope: "statistics", decision, version: CONSENT_NOTICE_VERSION },
      });
    expect(await answer("denied")).toBe("ok");
    await ingestEvents(db, { workspaceId: wsF, body: { token, events: reading } });
    expect(await stored()).toEqual(["consent_denied", "page_view", "share", "share"]);

    // Asked again via „Datenschutz-Einstellungen“: from now on, nothing backfilled.
    expect(await answer("given")).toBe("ok");
    await ingestEvents(db, { workspaceId: wsF, body: { token, events: reading.slice(0, 3) } });
    expect(await stored()).toContain("section_view");
    const [counted] = await db.select().from(schema.visits).where(eq(schema.visits.id, visitId));
    expect(counted).toMatchObject({ activeSeconds: 15, maxScroll: 50 });

    // Withdrawing deletes this visit's statistics; the basis and the proof stay.
    expect(await answer("withdrawn")).toBe("ok");
    expect(await stored()).toEqual([
      "consent_denied",
      "consent_given",
      "consent_withdrawn",
      "page_view",
      "share",
      "share",
    ]);
    const [after] = await db.select().from(schema.visits).where(eq(schema.visits.id, visitId));
    expect(after).toMatchObject({ activeSeconds: 0, maxScroll: 0 });
    const proof = await db
      .select({ scope: schema.consents.scope, decision: schema.consents.decision })
      .from(schema.consents)
      .where(eq(schema.consents.visitId, visitId));
    expect(proof.map((row) => `${row.scope}:${row.decision}`).sort()).toEqual([
      "statistics:denied",
      "statistics:given",
      "statistics:withdrawn",
    ]);
  });

  it("asks for consent, but not on the owner's device or with Global Privacy Control", async () => {
    const start = (extra: Record<string, string>, internal = false) =>
      startVisit(db, {
        workspaceId: wsF,
        body: { slug: cafe.slug },
        headers: headers(PHONE, extra),
        internal,
      });
    expect(await start({})).toMatchObject({ consentNotice: true });
    expect(await start({ "sec-gpc": "1" })).toMatchObject({ consentNotice: false });
    expect(await start({}, true)).toMatchObject({ consentNotice: false });
  });
});
