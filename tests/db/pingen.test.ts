import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
import type { LetterDispatchProvider } from "@/infra";
import { publishExpose, type PublishResult } from "@/server/exposes/publish";
import { createLetters, dispatchLetters, storeLetterPdf } from "@/server/letters/manage";
import {
  activePrintProvider,
  loadPingenSettings,
  savePingenSettings,
} from "@/server/letters/providers";
import { syncLetterStatuses } from "@/server/letters/sync";
import { createWorkspace } from "@/server/workspaces";
import { POST as pingenWebhook } from "@/app/api/webhooks/pingen/[workspaceId]/route";
import { minimalExpose } from "../support/expose";

/** §7.9 Pingen as print provider: credentials, dispatch, webhooks and the status sync. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
// The webhook route reads through getDb(), which must reach the test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.INTEGRATIONS_ENCRYPTION_KEY ||= btoa(
  String.fromCharCode(...new Uint8Array(32).fill(7)),
);

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const pia = { id: "user-pia", email: "pia@p.test", name: "Pia" };
let ws = "";
let actor: Actor;
let cafe: PublishResult;
let shop: PublishResult;

const asPia = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: pia.id, workspaceId: ws }, fn);

const PDF = new TextEncoder().encode("%PDF-1.7\n%test\n");
const DAY = 24 * 3600 * 1000;

async function sign(body: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

const letter = async (id: string) =>
  (await db.select().from(schema.letters).where(eq(schema.letters.id, id)))[0]!;

beforeAll(async () => {
  await db.insert(schema.users).values(pia);
  const created = await createWorkspace(db, {
    userId: pia.id,
    name: "Agentur Pingen",
    slug: "agentur-pingen-test",
  });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  actor = { userId: pia.id, role: "owner", workspaceId: ws };
  const publish = (key: string, company: string) =>
    asPia((tx) =>
      publishExpose(
        tx,
        { workspaceId: ws, userId: pia.id, source: "api" },
        { document: minimalExpose(key, company), assets: [] },
      ),
    );
  cafe = await publish("cafe-pingen", "Café Pingen");
  shop = await publish("laden-pingen", "Laden Pingen");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await close();
});

describe("credentials", () => {
  it("are stored encrypted and never shown again", async () => {
    expect(await asPia((tx) => activePrintProvider(tx, ws))).toBeNull();
    const refused = await asPia((tx) =>
      savePingenSettings(tx, actor, {
        enabled: true,
        staging: true,
        organisationId: "org-1",
        clientId: "client-1",
        clientSecret: "",
        webhookSecret: "",
      }),
    );
    expect(refused.ok).toBe(false);
    const saved = await asPia((tx) =>
      savePingenSettings(tx, actor, {
        enabled: true,
        staging: true,
        organisationId: "org-1",
        clientId: "client-1",
        clientSecret: "very-secret",
        webhookSecret: "hook-secret",
      }),
    );
    expect(saved).toEqual({ ok: true });
    const [row] = await db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.workspaceId, ws));
    expect(row!.secretCiphertext).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain("very-secret");
    expect(await asPia((tx) => loadPingenSettings(tx, ws))).toEqual({
      enabled: true,
      staging: true,
      organisationId: "org-1",
      clientId: "client-1",
      hasClientSecret: true,
      hasWebhookSecret: true,
      canStoreSecrets: true,
    });
    // An empty secret field keeps what is stored.
    await asPia((tx) =>
      savePingenSettings(tx, actor, {
        enabled: true,
        staging: true,
        organisationId: "org-1",
        clientId: "client-2",
        clientSecret: "",
        webhookSecret: "",
      }),
    );
    expect((await asPia((tx) => activePrintProvider(tx, ws)))?.id).toBe("pingen");
    expect(await asPia((tx) => loadPingenSettings(tx, ws))).toMatchObject({
      clientId: "client-2",
      hasClientSecret: true,
    });
  });
});

describe("dispatch", () => {
  let cafeLetter = "";
  let shopLetter = "";

  beforeAll(async () => {
    const { created } = await asPia((tx) =>
      createLetters(tx, actor, {
        prospectIds: [cafe.prospectId, shop.prospectId],
        kind: "initial",
      }),
    );
    [cafeLetter, shopLetter] = created as [string, string];
  });

  it("keeps only real PDFs of drafts", async () => {
    expect(
      await asPia((tx) => storeLetterPdf(tx, actor, cafeLetter, new Uint8Array([1, 2, 3]))),
    ).toBe(false);
    expect(await asPia((tx) => storeLetterPdf(tx, actor, cafeLetter, PDF))).toBe(true);
  });

  it("hands drafts to the provider, keeps refused ones as drafts with the reason", async () => {
    const sent: string[] = [];
    const provider: LetterDispatchProvider = {
      id: "pingen",
      tracksDelivery: true,
      async send(request) {
        expect(request.pdfKey).toBe(`${ws}/letters/${request.letterId}.pdf`);
        if (request.letterId === shopLetter) throw new Error("Pingen: Address not recognised");
        sent.push(request.letterId);
        return { providerRef: "p-cafe" };
      },
      async getStatus() {
        return null;
      },
      async cancel() {},
      async estimateCost() {
        return null;
      },
    };
    const result = await asPia((tx) =>
      dispatchLetters(tx, actor, [cafeLetter, shopLetter], provider),
    );
    expect(result).toEqual({
      sent: 1,
      failed: [{ letterId: shopLetter, message: "Pingen: Address not recognised" }],
    });
    expect(await letter(cafeLetter)).toMatchObject({
      status: "submitted",
      provider: "pingen",
      providerRef: "p-cafe",
    });
    expect(await letter(shopLetter)).toMatchObject({
      status: "draft",
      failureReason: "Pingen: Address not recognised",
    });
    // A letter already handed over is not sent twice.
    expect((await asPia((tx) => dispatchLetters(tx, actor, [cafeLetter], provider))).sent).toBe(0);
    expect(sent).toEqual([cafeLetter]);
  });

  it("a signed webhook marks the letter as posted, once", async () => {
    const body = JSON.stringify({
      data: {
        type: "webhook_sent",
        id: "evt-1",
        attributes: { created_at: "2026-10-22T09:00:00+0200" },
        relationships: { letter: { data: { type: "letters", id: "p-cafe" } } },
      },
      included: [
        { type: "letters", id: "p-cafe", attributes: { status: "sent", price_value: 1.43 } },
      ],
    });
    const call = async (signature: string) =>
      pingenWebhook(
        new Request(`http://localhost:3000/api/webhooks/pingen/${ws}`, {
          method: "POST",
          headers: { signature },
          body,
        }),
        { params: Promise.resolve({ workspaceId: ws }) },
      );
    expect((await call(await sign(body, "wrong"))).status).toBe(401);
    expect((await letter(cafeLetter)).status).toBe("submitted");
    expect((await call(await sign(body, "hook-secret"))).status).toBe(204);
    expect(await letter(cafeLetter)).toMatchObject({
      status: "posted",
      costCents: 143,
      postedAt: new Date("2026-10-22T07:00:00Z"),
      printedAt: new Date("2026-10-22T07:00:00Z"),
    });
    const [prospect] = await db
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.id, cafe.prospectId));
    expect(prospect!.status).toBe("letter_sent");
    // Pingen delivers at least once: the repeat changes nothing.
    expect((await call(await sign(body, "hook-secret"))).status).toBe(204);
    const usage = await db
      .select()
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.workspaceId, ws));
    expect(usage.filter((event) => event.kind === "letter")).toHaveLength(1);
  });

  it("an unknown workspace or a malformed id is not found", async () => {
    const response = await pingenWebhook(
      new Request("http://localhost:3000/api/webhooks/pingen/x", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ workspaceId: "x" }) },
    );
    expect(response.status).toBe(404);
  });

  it("the hourly sync asks Pingen about letters on their way", async () => {
    await db
      .update(schema.letters)
      .set({
        status: "submitted",
        provider: "pingen",
        providerRef: "p-shop",
        submittedAt: new Date(Date.now() - 2 * DAY),
      })
      .where(eq(schema.letters.id, shopLetter));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/access-tokens")) {
        return Response.json({ access_token: "tok", expires_in: 43200 });
      }
      if (url.endsWith("/organisations/org-1/deliveries/letters/p-shop")) {
        return Response.json({ data: { id: "p-shop", attributes: { status: "undeliverable" } } });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await syncLetterStatuses(db);
    expect(result.changed).toBe(1);
    expect(await letter(shopLetter)).toMatchObject({ status: "returned" });
  });
});
