import "server-only";
import type { Transaction } from "@/db";
import { periodDays, type Period } from "@/domain/analytics/period";
import type { AnalyticsFilter } from "./filters";
import { loadActivity, loadFunnels, loadKpis } from "./overview";

/** Everything the overview sections need, in one round. */
export async function loadOverview(
  tx: Transaction,
  workspaceId: string,
  filter: AnalyticsFilter,
  period: Period,
  timeZone: string,
) {
  // One connection per transaction: run sequentially.
  const kpis = await loadKpis(tx, workspaceId, filter, period);
  const funnels = await loadFunnels(tx, workspaceId, filter, period);
  const activity = await loadActivity(tx, workspaceId, filter, period, timeZone);
  return { kpis, funnels, activity, days: periodDays(period) };
}
