import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "../types";
import { mapPingenStatus, pingenLetters, type PingenConfig } from "./letters";

const config: PingenConfig = {
  organisationId: "org-1",
  clientId: "client-1",
  clientSecret: "secret-1",
  webhookSecret: "whsec",
  staging: true,
};

const options = {
  color: false,
  duplex: true,
  shipping: "standard" as const,
  envelope: "DL" as const,
  inserts: [],
};

function storage(pdf: Uint8Array<ArrayBuffer> | null): StoragePort {
  return {
    put: vi.fn(),
    delete: vi.fn(),
    deletePrefix: vi.fn(),
    get: vi.fn(async () =>
      pdf
        ? { body: new Response(pdf).body!, contentType: "application/pdf", size: pdf.byteLength }
        : null,
    ),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake Pingen: routes by method and path, records every call. */
function fakePingen(routes: Record<string, (init: RequestInit) => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const key = `${init.method ?? "GET"} ${url.host}${url.pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected ${key}`);
    return route(init);
  });
}

const tokenRoute = {
  "POST identity-staging.pingen.com/auth/access-tokens": () =>
    json({ access_token: "tok", expires_in: 43200, token_type: "Bearer" }),
};

describe("pingenLetters", () => {
  it("uploads the PDF and creates a letter that sends itself", async () => {
    const fetcher = fakePingen({
      ...tokenRoute,
      "GET api-staging.pingen.com/file-upload": () =>
        json({ data: { attributes: { url: "https://upload.test/f", url_signature: "sig" } } }),
      "PUT upload.test/f": () => new Response(null, { status: 200 }),
      "POST api-staging.pingen.com/organisations/org-1/deliveries/letters/": () =>
        json({ data: { id: "pingen-letter-1", type: "letters" } }, 201),
    });
    const provider = pingenLetters(
      { ...config, clientId: "client-send" },
      { storage: storage(new Uint8Array([37, 80, 68, 70])), fetch: fetcher as typeof fetch },
    );
    const result = await provider.send({
      letterId: "l1",
      workspaceId: "w1",
      pdfKey: "w1/letters/l1.pdf",
      options,
      idempotencyKey: "l1",
    });
    expect(result).toEqual({ providerRef: "pingen-letter-1" });
    const token = fetcher.mock.calls[0]![1]!;
    expect(String(token.body)).toContain("grant_type=client_credentials");
    const put = fetcher.mock.calls[2]![1]!;
    expect(new Headers(put.headers).get("authorization")).toBeNull();
    const create = fetcher.mock.calls[3]![1]!;
    const headers = new Headers(create.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
    expect(headers.get("idempotency-key")).toBe("l1");
    expect(headers.get("content-type")).toBe("application/vnd.api+json");
    expect(JSON.parse(String(create.body))).toEqual({
      data: {
        type: "letters",
        attributes: {
          file_original_name: "brief-l1.pdf",
          file_url: "https://upload.test/f",
          file_url_signature: "sig",
          address_position: "left",
          auto_send: true,
          delivery_product: "cheap",
          print_mode: "duplex",
          print_spectrum: "grayscale",
        },
      },
    });
  });

  it("refuses to send without a PDF", async () => {
    const provider = pingenLetters(config, { storage: storage(null), fetch: vi.fn() });
    await expect(
      provider.send({
        letterId: "l1",
        workspaceId: "w1",
        pdfKey: null,
        options,
        idempotencyKey: "l1",
      }),
    ).rejects.toThrow("PDF");
  });

  it("reads status and price, cancels and reports Pingen's error text", async () => {
    const fetcher = fakePingen({
      ...tokenRoute,
      "GET api-staging.pingen.com/organisations/org-1/deliveries/letters/p1": () =>
        json({ data: { id: "p1", attributes: { status: "sent", price_value: 1.43 } } }),
      "PATCH api-staging.pingen.com/organisations/org-1/deliveries/letters/p1/cancel": () =>
        json({ errors: [{ detail: "Letter can no longer be cancelled." }] }, 422),
      "POST api-staging.pingen.com/organisations/org-1/deliveries/letters/price-calculator": (
        init,
      ) => {
        const body = JSON.parse(String(init.body));
        expect(body.data.attributes).toMatchObject({
          country: "AT",
          paper_types: ["normal", "normal"],
          delivery_product: "fast",
        });
        return json({ data: { attributes: { currency: "EUR", price: 1.25 } } });
      },
    });
    const provider = pingenLetters(
      { ...config, clientId: "client-status" },
      { storage: storage(null), fetch: fetcher as typeof fetch },
    );
    expect(await provider.getStatus("p1")).toEqual({ status: "posted", costCents: 143 });
    await expect(provider.cancel("p1")).rejects.toThrow("Letter can no longer be cancelled.");
    expect(
      await provider.estimateCost({
        options: { ...options, shipping: "priority" },
        country: "AT",
        pages: 2,
      }),
    ).toEqual({ cents: 125 });
    // One token for all three calls.
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("identity"))).toHaveLength(1);
  });

  it("names rejected credentials", async () => {
    const fetcher = fakePingen({
      "POST identity-staging.pingen.com/auth/access-tokens": () => json({}, 401),
    });
    const provider = pingenLetters(
      { ...config, clientId: "client-bad" },
      { storage: storage(null), fetch: fetcher as typeof fetch },
    );
    await expect(provider.checkConnection!()).rejects.toThrow("Zugangsdaten");
  });

  describe("webhooks", () => {
    const provider = pingenLetters(config, { storage: storage(null), fetch: vi.fn() });
    const sign = async (body: string, secret = "whsec") => {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
      return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
    };
    const event = (type: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        data: {
          type,
          id: "evt-1",
          attributes: { created_at: "2026-10-22T09:15:00+0200", ...extra },
          relationships: { letter: { data: { type: "letters", id: "p1" } } },
        },
        included: [
          { type: "letters", id: "p1", attributes: { status: "sent", price_value: 1.43 } },
        ],
      });
    const request = (body: string, signature: string) =>
      new Request("https://app.test/api/webhooks/pingen/w1", {
        method: "POST",
        headers: { signature },
        body,
      });

    it("accepts a signed „sent“ event", async () => {
      const body = event("webhook_sent");
      expect(await provider.handleWebhook!(request(body, await sign(body)))).toEqual([
        {
          providerRef: "p1",
          status: "posted",
          at: new Date("2026-10-22T07:15:00Z"),
          costCents: 143,
          reason: null,
        },
      ]);
    });

    it("turns an issue into a failure with Pingen's reason", async () => {
      const body = event("webhook_issues", { reason: "Address not found" });
      const [update] = await provider.handleWebhook!(request(body, await sign(body)));
      expect(update).toMatchObject({ status: "failed", reason: "Address not found" });
    });

    it("rejects a wrong or missing signature", async () => {
      const body = event("webhook_sent");
      await expect(
        provider.handleWebhook!(request(body, await sign(body, "other"))),
      ).rejects.toThrow("Signatur");
      await expect(provider.handleWebhook!(request(body, ""))).rejects.toThrow("Signatur");
    });
  });
});

describe("mapPingenStatus", () => {
  it("maps Pingen's states onto the letter lifecycle", () => {
    expect(mapPingenStatus("validating")).toBe("submitted");
    expect(mapPingenStatus("sent")).toBe("posted");
    expect(mapPingenStatus("undeliverable")).toBe("returned");
    expect(mapPingenStatus("action_required")).toBe("failed");
    expect(mapPingenStatus("cancelled")).toBe("cancelled");
    expect(mapPingenStatus("something_new")).toBeNull();
  });
});
