import { serverEnv } from "@/config/env";
import { getDb } from "@/db";
import { timingSafeEqual } from "@/domain/tracking/signed-token";
import { geocodePending } from "@/server/geocoding";
import { runDigests } from "@/server/notifications/digest";
import { runRetention } from "@/server/retention";
import { purgeExpiredReplays } from "@/server/tracking/replay";

export const dynamic = "force-dynamic";

/**
 * Hourly jobs: daily digest (§7.7), retention of events, opt-outs and replays (§9), map
 * positions (§7.8). Called by the Cloudflare cron trigger
 * (worker.mjs) or any scheduler with `Authorization: Bearer $CRON_SECRET`.
 * Idempotent: running it twice in an hour sends nothing twice.
 */
export async function POST(request: Request) {
  const secret = serverEnv().CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqual(given, `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = getDb();
  const digests = await runDigests(db);
  const replaysPurged = await purgeExpiredReplays(db);
  const retention = await runRetention(db);
  const geocoding = await geocodePending(db);
  return Response.json({ digests, replaysPurged, retention, geocoding });
}
