import type {
  LetterDispatchProvider,
  LetterPrintOptions,
  LetterProviderUpdate,
  LetterStatus,
  StoragePort,
} from "../types";

/**
 * Pingen (§7.9 „Erster echter Provider“): REST API v2 with OAuth2 client
 * credentials, a presigned file upload and JSON:API bodies. Endpoints follow
 * Pingen's official SDK (pingencom/pingen2-sdk-php). Credentials are per
 * workspace; the app decrypts them and builds one provider per request.
 */

export interface PingenConfig {
  organisationId: string;
  clientId: string;
  clientSecret: string;
  /** Signing key of the webhook set up in Pingen; null: webhooks are refused. */
  webhookSecret: string | null;
  /** Pingen's staging environment (free, prints nothing). */
  staging: boolean;
}

const HOSTS = {
  production: { api: "https://api.pingen.com", identity: "https://identity.pingen.com" },
  staging: {
    api: "https://api-staging.pingen.com",
    identity: "https://identity-staging.pingen.com",
  },
};

const JSON_API = "application/vnd.api+json";
const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * Pingen's letter states mapped onto the app's lifecycle. Unknown states map
 * to null and leave the letter as it is.
 */
export function mapPingenStatus(status: string): LetterStatus | null {
  switch (status) {
    case "validating":
    case "valid":
    case "submitted":
    case "accepted":
      return "submitted";
    case "printing":
    case "printed":
      return "printed";
    case "sent":
    case "delivered":
      return "posted";
    case "undeliverable":
      return "returned";
    case "cancelled":
      return "cancelled";
    case "action_required":
    case "invalid":
    case "unprintable":
    case "expired":
      return "failed";
    default:
      return null;
  }
}

/** Pingen's delivery products: „cheap“ is the standard letter, „fast“ the priority one. */
function printAttributes(options: LetterPrintOptions) {
  return {
    delivery_product: options.shipping === "priority" ? "fast" : "cheap",
    print_mode: options.duplex ? "duplex" : "simplex",
    print_spectrum: options.color ? "color" : "grayscale",
  };
}

const toCents = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;

export class PingenError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PingenError";
  }
}

async function hmacHex(secret: string, body: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, body);
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readAll(stream: ReadableStream): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Tokens live 12 hours at Pingen; cached per client id with a safety margin. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function pingenLetters(
  config: PingenConfig,
  deps: { storage: StoragePort; fetch?: typeof fetch; now?: () => number },
): LetterDispatchProvider {
  const fetcher = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const host = config.staging ? HOSTS.staging : HOSTS.production;
  const cacheKey = `${config.staging ? "staging" : "production"}:${config.clientId}`;
  const org = `/organisations/${encodeURIComponent(config.organisationId)}`;

  async function token(): Promise<string> {
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > now()) return cached.token;
    const response = await fetcher(`${host.identity}/auth/access-tokens`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    if (!response.ok) {
      throw new PingenError("Pingen hat die Zugangsdaten abgelehnt.", response.status);
    }
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new PingenError("Pingen hat kein Token geliefert.", 502);
    tokenCache.set(cacheKey, {
      token: body.access_token,
      expiresAt: now() + Math.max(60, (body.expires_in ?? 3600) - 300) * 1000,
    });
    return body.access_token;
  }

  async function api(
    path: string,
    init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<Record<string, unknown> | null> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await token()}`,
      accept: JSON_API,
    };
    if (init.body !== undefined) headers["content-type"] = JSON_API;
    if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
    const response = await fetcher(`${host.api}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (response.status === 401) tokenCache.delete(cacheKey);
    if (!response.ok) {
      const detail = await response
        .json()
        .then(
          (body: { errors?: { detail?: string; title?: string }[] }) =>
            body.errors?.[0]?.detail ?? body.errors?.[0]?.title,
        )
        .catch(() => undefined);
      throw new PingenError(
        detail ? `Pingen: ${detail}` : `Pingen antwortet mit ${response.status}.`,
        response.status,
      );
    }
    return response.status === 204 ? null : ((await response.json()) as Record<string, unknown>);
  }

  type Resource = { data?: { id?: string; attributes?: Record<string, unknown> } };

  return {
    id: "pingen",
    tracksDelivery: true,

    async send(letter) {
      if (!letter.pdfKey) throw new PingenError("Für Pingen fehlt das PDF des Briefs.", 400);
      const file = await deps.storage.get(letter.pdfKey);
      if (!file) throw new PingenError("Das PDF des Briefs wurde nicht gefunden.", 404);
      const pdf = await readAll(file.body);
      const upload = (await api("/file-upload")) as Resource;
      const url = upload.data?.attributes?.url;
      const signature = upload.data?.attributes?.url_signature;
      if (typeof url !== "string" || typeof signature !== "string") {
        throw new PingenError("Pingen hat keine Upload-Adresse geliefert.", 502);
      }
      const put = await fetcher(url, {
        method: "PUT",
        headers: { "content-type": "application/pdf" },
        body: pdf,
      });
      if (!put.ok) throw new PingenError("Das PDF konnte nicht zu Pingen hochgeladen werden.", 502);
      const created = (await api(`${org}/deliveries/letters/`, {
        method: "POST",
        idempotencyKey: letter.idempotencyKey,
        body: {
          data: {
            type: "letters",
            attributes: {
              file_original_name: `brief-${letter.letterId}.pdf`,
              file_url: url,
              file_url_signature: signature,
              // DIN 5008 window envelope: the address sits on the left.
              address_position: "left",
              auto_send: true,
              ...printAttributes(letter.options),
            },
          },
        },
      })) as Resource;
      const id = created.data?.id;
      if (!id) throw new PingenError("Pingen hat keine Brief-ID geliefert.", 502);
      return { providerRef: id };
    },

    async getStatus(providerRef) {
      const letter = (await api(
        `${org}/deliveries/letters/${encodeURIComponent(providerRef)}`,
      )) as Resource;
      const attributes = letter.data?.attributes ?? {};
      const status = mapPingenStatus(String(attributes.status ?? ""));
      return status ? { status, costCents: toCents(attributes.price_value) } : null;
    },

    async cancel(providerRef) {
      await api(`${org}/deliveries/letters/${encodeURIComponent(providerRef)}/cancel`, {
        method: "PATCH",
      });
    },

    async estimateCost(letter) {
      const result = (await api(`${org}/deliveries/letters/price-calculator`, {
        method: "POST",
        body: {
          data: {
            type: "letter_price_calculator",
            attributes: {
              country: letter.country ?? "DE",
              paper_types: Array.from({ length: Math.max(1, letter.pages ?? 1) }, () => "normal"),
              ...printAttributes(letter.options),
            },
          },
        },
      })) as Resource;
      const cents = toCents(result.data?.attributes?.price);
      return cents === null ? null : { cents };
    },

    async checkConnection() {
      const organisation = (await api(org)) as Resource;
      return { name: String(organisation.data?.attributes?.name ?? "") };
    },

    async handleWebhook(request) {
      if (!config.webhookSecret) throw new PingenError("Kein Webhook-Schlüssel hinterlegt.", 401);
      const length = Number(request.headers.get("content-length") ?? 0);
      if (length > MAX_WEBHOOK_BYTES) throw new PingenError("Webhook zu groß.", 413);
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.byteLength > MAX_WEBHOOK_BYTES) throw new PingenError("Webhook zu groß.", 413);
      const given = (request.headers.get("signature") ?? "").toLowerCase();
      if (!given || !constantTimeEqual(await hmacHex(config.webhookSecret, body), given)) {
        throw new PingenError("Webhook-Signatur ungültig.", 401);
      }
      const payload = JSON.parse(new TextDecoder().decode(body)) as {
        data?: {
          type?: string;
          attributes?: { reason?: string; created_at?: string };
          relationships?: { letter?: { data?: { id?: string } } };
        };
        included?: { type?: string; id?: string; attributes?: Record<string, unknown> }[];
      };
      const event = payload.data;
      const providerRef = event?.relationships?.letter?.data?.id;
      if (!event || !providerRef) return [];
      const included = payload.included?.find(
        (item) => item.type === "letters" && item.id === providerRef,
      );
      const byCategory: Record<string, LetterStatus> = {
        webhook_sent: "posted",
        webhook_undeliverable: "returned",
        webhook_issues: "failed",
      };
      const status =
        byCategory[event.type ?? ""] ?? mapPingenStatus(String(included?.attributes?.status ?? ""));
      if (!status) return [];
      const at = event.attributes?.created_at ? new Date(event.attributes.created_at) : new Date();
      const update: LetterProviderUpdate = {
        providerRef,
        status,
        at: Number.isNaN(at.getTime()) ? new Date() : at,
        costCents: toCents(included?.attributes?.price_value),
        reason: status === "failed" ? (event.attributes?.reason ?? null) : null,
      };
      return [update];
    },
  };
}
