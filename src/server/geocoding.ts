import "server-only";
import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import type { Database } from "@/db";
import { prospects } from "@/db/schema";
import { getInfra, type GeocoderPort } from "@/infra";

/**
 * Places prospects on the map (§7.8). Runs in the hourly job on the system
 * connection, across workspaces, oldest first. A miss is stored too
 * (geocoded_at set, no coordinates) so an address is asked for only once;
 * editing the address queues it again. A provider error ends the round.
 */
export async function geocodePending(
  db: Database,
  options: {
    limit?: number;
    /** Only this workspace (the „Jetzt verorten“ button). */
    workspaceId?: string;
    geocoder?: GeocoderPort | null;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ found: number; missed: number; failed: boolean }> {
  const geocoder = options.geocoder === undefined ? getInfra().geocoder : options.geocoder;
  const result = { found: 0, missed: 0, failed: false };
  if (!geocoder) return result;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const pending = await db
    .select({
      id: prospects.id,
      workspaceId: prospects.workspaceId,
      street: prospects.street,
      postalCode: prospects.postalCode,
      city: prospects.city,
      country: prospects.country,
    })
    .from(prospects)
    .where(
      and(
        isNull(prospects.geocodedAt),
        options.workspaceId ? eq(prospects.workspaceId, options.workspaceId) : undefined,
        or(isNotNull(prospects.city), isNotNull(prospects.postalCode)),
      ),
    )
    .orderBy(asc(prospects.createdAt))
    .limit(options.limit ?? 40);
  for (const [index, prospect] of pending.entries()) {
    if (index > 0 && geocoder.minIntervalMs > 0) await sleep(geocoder.minIntervalMs);
    let point: { latitude: number; longitude: number } | null;
    try {
      point = await geocoder.geocode(prospect);
    } catch (error) {
      console.warn("geocoding stopped", error);
      result.failed = true;
      break;
    }
    await db
      .update(prospects)
      .set({
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        geocodedAt: new Date(),
      })
      .where(and(eq(prospects.workspaceId, prospect.workspaceId), eq(prospects.id, prospect.id)));
    if (point) result.found++;
    else result.missed++;
  }
  return result;
}
