import { serverEnv } from "@/config/env";
import { getDb } from "@/db";
import { runDigests } from "@/server/notifications/digest";

export const dynamic = "force-dynamic";

/**
 * Hourly jobs (§7.7 daily digest). Called by the Cloudflare cron trigger
 * (worker.mjs) or any scheduler with `Authorization: Bearer $CRON_SECRET`.
 * Idempotent: running it twice in an hour sends nothing twice.
 */
export async function POST(request: Request) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const digests = await runDigests(getDb());
  return Response.json({ digests });
}
