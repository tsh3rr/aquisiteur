import "server-only";
import { parsePeriod } from "@/domain/analytics/period";
import type { Transaction } from "@/db";
import { listCampaigns } from "@/server/campaigns";
import { parseFilter } from "./filters";
import { loadFilterOptions } from "./overview";

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of every query parameter. */
export function flatParams(params: SearchParams): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
}

/** Period, filter and the query string to hand on (CSV links, tabs). */
export function readDashboardParams(raw: SearchParams) {
  const params = flatParams(raw);
  const { period, preset } = parsePeriod(params);
  const filter = parseFilter(params);
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  return { period, preset, filter, query };
}

export async function loadOptions(tx: Transaction, workspaceId: string) {
  const [options, campaigns] = await Promise.all([
    loadFilterOptions(tx, workspaceId),
    listCampaigns(tx, workspaceId, { includeArchived: true }),
  ]);
  return { ...options, campaigns: campaigns.map(({ id, name }) => ({ id, name })) };
}
