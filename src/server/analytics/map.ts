import "server-only";
import { sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import { isProspectStatus, type ProspectStatus } from "@/domain/prospects/status";
import { prospectScope, type AnalyticsFilter } from "./filters";

export interface MapPoint {
  id: string;
  companyName: string;
  city: string | null;
  status: ProspectStatus;
  score: number | null;
  latitude: number;
  longitude: number;
}

export interface MapData {
  points: MapPoint[];
  /** Neither city nor postal code. */
  withoutAddress: number;
  /** Waiting for the hourly geocoding. */
  pending: number;
  /** Looked up, but the address was not found. */
  notFound: number;
}

/** Prospects on the map (§7.8), current state, filtered like the dashboards. */
export async function loadMapData(
  tx: Transaction,
  workspaceId: string,
  filter: AnalyticsFilter,
): Promise<MapData> {
  const scope = prospectScope(workspaceId, filter);
  const [rows, [counts]] = await Promise.all([
    tx.execute<{
      id: string;
      company_name: string;
      city: string | null;
      status: string;
      score: number | null;
      latitude: number;
      longitude: number;
    }>(sql`
      select p.id, p.company_name, p.city, p.status::text as status, s.score, p.latitude, p.longitude
      from prospects p
      left join intent_scores s on s.workspace_id = p.workspace_id and s.prospect_id = p.id
      where ${scope} and p.latitude is not null and p.longitude is not null
      order by p.company_name
      limit 2000`),
    tx.execute<{ without_address: string; pending: string; not_found: string }>(sql`
      select
        count(*) filter (where p.city is null and p.postal_code is null) as without_address,
        count(*) filter (where (p.city is not null or p.postal_code is not null) and p.geocoded_at is null) as pending,
        count(*) filter (where p.geocoded_at is not null and p.latitude is null) as not_found
      from prospects p where ${scope}`),
  ]);
  return {
    points: rows.flatMap((row) =>
      isProspectStatus(row.status)
        ? [
            {
              id: row.id,
              companyName: row.company_name,
              city: row.city,
              status: row.status,
              score: row.score === null ? null : Number(row.score),
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
            },
          ]
        : [],
    ),
    withoutAddress: Number(counts?.without_address ?? 0),
    pending: Number(counts?.pending ?? 0),
    notFound: Number(counts?.not_found ?? 0),
  };
}
