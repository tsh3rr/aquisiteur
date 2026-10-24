import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Health check for the server's deployment (Docker Compose, ADR-0054), reached as
 * `/healthz` on any host (src/middleware.ts). 200 only when the database
 * answers, so a new version goes live only once it can serve.
 */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return new Response("ok", { headers: { "cache-control": "no-store" } });
  } catch {
    return new Response("database unavailable", { status: 503 });
  }
}
