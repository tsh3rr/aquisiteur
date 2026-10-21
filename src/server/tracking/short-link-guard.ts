import "server-only";
import { serverEnv } from "@/config/env";
import type { Database } from "@/db";
import { clientIp, rateLimitBucket } from "@/lib/client-ip";
import { sha256Hex } from "@/lib/crypto";
import { hitRateLimit, rateLimitReached } from "./rate-limit";

/**
 * Enumeration guard for short links (§10 „Kurzlinks rate-limitiert gegen
 * Enumeration“). Short codes are short on purpose (typed from a letter), so
 * a client that keeps asking for unknown codes is stopped: after
 * MISS_LIMIT unknown codes in the window it gets no suggestions and no
 * resolution at all until the window ends. The client is a keyed hash of its
 * IP address (IPv6 by its /64 network, which one connection usually owns),
 * never the address itself, and the counter row expires with the hourly
 * cleanup.
 */
export const MISS_LIMIT = { count: 20, windowSeconds: 600 } as const;

export async function clientKey(headers: Headers): Promise<string> {
  const ip = rateLimitBucket(clientIp(headers));
  return (await sha256Hex(`${serverEnv().BETTER_AUTH_SECRET}|short-link|${ip}`)).slice(0, 24);
}

const missKey = (workspaceId: string, client: string) => `miss:${workspaceId}:${client}`;

export function shortLinksBlocked(db: Database, workspaceId: string, client: string) {
  return rateLimitReached(
    db,
    missKey(workspaceId, client),
    MISS_LIMIT.count,
    MISS_LIMIT.windowSeconds,
  );
}

/** Counts one unknown code; false once the client is over the limit. */
export function recordMiss(db: Database, workspaceId: string, client: string) {
  return hitRateLimit(db, missKey(workspaceId, client), MISS_LIMIT.count, MISS_LIMIT.windowSeconds);
}
