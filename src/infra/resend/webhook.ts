import type { EmailEvent, EmailWebhookPort } from "../types";

/**
 * Resend's delivery webhooks, signed the Svix way: HMAC-SHA256 over
 * `<id>.<timestamp>.<body>` with the base64 secret after `whsec_`, sent as
 * `v1,<base64>` (several, space separated, during a key rotation). Requests
 * older or newer than five minutes are refused against replays.
 */

const TOLERANCE_SECONDS = 5 * 60;

const STATUS: Record<string, EmailEvent["status"]> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

class WebhookError extends Error {
  constructor(readonly status: number) {
    super(`webhook rejected (${status})`);
  }
}

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function svixSignature(secret: string, id: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    bytesOf(secret.replace(/^whsec_/, "")) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return new Uint8Array(signed);
}

function detailOf(data: Record<string, unknown>): string | null {
  const bounce = data.bounce as { message?: unknown; subType?: unknown } | undefined;
  const failed = data.failed as { reason?: unknown } | undefined;
  const text = bounce?.message ?? failed?.reason ?? null;
  return typeof text === "string" ? text.slice(0, 500) : null;
}

export function resendWebhook(
  secret: string,
  now: () => Date = () => new Date(),
): EmailWebhookPort {
  return {
    async parse(body, headers) {
      const id = headers.get("svix-id");
      const timestamp = headers.get("svix-timestamp");
      const signatures = headers.get("svix-signature");
      if (!id || !timestamp || !signatures) throw new WebhookError(401);
      const seconds = Number(timestamp);
      if (
        !Number.isFinite(seconds) ||
        Math.abs(now().getTime() / 1000 - seconds) > TOLERANCE_SECONDS
      ) {
        throw new WebhookError(401);
      }
      const expected = await svixSignature(secret, id, timestamp, body);
      const valid = signatures.split(" ").some((entry) => {
        const [version, value] = entry.split(",", 2);
        if (version !== "v1" || !value) return false;
        try {
          return equal(bytesOf(value), expected);
        } catch {
          return false;
        }
      });
      if (!valid) throw new WebhookError(401);
      let event: { type?: unknown; created_at?: unknown; data?: Record<string, unknown> };
      try {
        event = JSON.parse(body);
      } catch {
        throw new WebhookError(400);
      }
      const status = typeof event.type === "string" ? STATUS[event.type] : undefined;
      const providerId = event.data?.email_id;
      if (!status || typeof providerId !== "string") return [];
      const at = typeof event.created_at === "string" ? new Date(event.created_at) : now();
      return [
        {
          providerId,
          status,
          at: Number.isNaN(at.getTime()) ? now() : at,
          detail: detailOf(event.data ?? {}),
        },
      ];
    },
  };
}
