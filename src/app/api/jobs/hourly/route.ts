import { serverEnv } from "@/config/env";
import { getDb } from "@/db";
import { timingSafeEqual } from "@/domain/tracking/signed-token";
import { geocodePending } from "@/server/geocoding";
import { runContractBilling } from "@/server/invoices/contracts";
import { runDunning } from "@/server/invoices/dunning";
import { runAutoFollowUps } from "@/server/letters/follow-up";
import { syncLetterStatuses } from "@/server/letters/sync";
import { runDigests } from "@/server/notifications/digest";
import { runRetention } from "@/server/retention";
import { runTaskReminders } from "@/server/tasks";
import { purgeExpiredReplays } from "@/server/tracking/replay";

export const dynamic = "force-dynamic";

/**
 * Hourly jobs: print API status and follow-up letters (§7.9), maintenance invoices and dunning (§7.10),
 * task reminders (§7.8), daily digest (§7.7), retention of events, opt-outs and replays (§9), map
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
  const letterStatuses = await syncLetterStatuses(db);
  // Before the reminders, so a prepared follow-up's task reminds in the same run.
  const followUps = await runAutoFollowUps(db);
  // Also before the reminders: an approval task for a new maintenance invoice is due today.
  const contracts = await runContractBilling(db);
  const dunning = await runDunning(db);
  const reminders = await runTaskReminders(db);
  const digests = await runDigests(db);
  const replaysPurged = await purgeExpiredReplays(db);
  const retention = await runRetention(db);
  const geocoding = await geocodePending(db);
  return Response.json({
    letterStatuses,
    followUps,
    contracts,
    dunning,
    reminders,
    digests,
    replaysPurged,
    retention,
    geocoding,
  });
}
