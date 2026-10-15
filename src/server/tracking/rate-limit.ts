import { sql } from "drizzle-orm";
import type { Database } from "@/db";

/**
 * Fixed-window counter in the shared `rate_limits` table (also used by
 * Better Auth, with its own keys). Returns false once `limit` hits within
 * `windowSeconds` were counted. One statement, so it holds under concurrency.
 */
export async function hitRateLimit(
  db: Database,
  key: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
): Promise<boolean> {
  const windowStart = now - windowSeconds * 1000;
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (id, key, count, last_request)
    values (${`aq:${key}`}, ${`aq:${key}`}, 1, ${now})
    on conflict (key) do update set
      count = case when rate_limits.last_request < ${windowStart} then 1 else rate_limits.count + 1 end,
      last_request = case when rate_limits.last_request < ${windowStart} then ${now} else rate_limits.last_request end
    returning count
  `);
  const count = Number(rows[0]?.count ?? 1);
  return count <= limit;
}
