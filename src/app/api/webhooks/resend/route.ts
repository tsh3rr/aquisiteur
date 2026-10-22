import { getDb } from "@/db";
import { getInfra } from "@/infra";
import { readTextLimited } from "@/lib/body";
import { recordEmailEvents } from "@/server/invoices/send";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * Delivery status from Resend (§7.10, 7c-2): one URL for the platform, signed
 * with RESEND_WEBHOOK_SECRET. Each event names the mail by Resend's id, which
 * maps to exactly one workspace's row. Delivery is at-least-once; repeated or
 * late events never move a status back. Inbound mail can arrive here later.
 */
export async function POST(request: Request) {
  const webhook = getInfra().emailWebhook;
  if (!webhook) return new Response("Not found", { status: 404 });
  const body = await readTextLimited(request, MAX_WEBHOOK_BYTES);
  if (body === null) return new Response("Too large", { status: 413 });
  let events;
  try {
    events = await webhook.parse(body, request.headers);
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 400;
    return new Response("Rejected", { status: status >= 400 && status < 500 ? status : 400 });
  }
  await recordEmailEvents(getDb(), events);
  return new Response(null, { status: 204 });
}
