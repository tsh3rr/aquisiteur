import "server-only";
import { and, count, eq, gte, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import type { Database, Transaction } from "@/db";
import { assets, exposes, memberships, platformAdmins, sessionReplays, visits } from "@/db/schema";
import { entitlements } from "@/domain/entitlements";
import { PLATFORM_LIMITS, usageReading, type UsageReading } from "@/domain/system-limits";
import { getInfra } from "@/infra";

/** Settings → System (§5a, §9a): usage against limits. */

export interface WorkspaceUsage {
  publishedExposes: UsageReading;
  monthlyVisits: UsageReading;
  members: UsageReading;
  storageBytes: UsageReading;
}

/** The workspace's own figures, read as tenant. */
export async function workspaceUsage(
  tx: Transaction,
  workspaceId: string,
  now = new Date(),
): Promise<WorkspaceUsage> {
  const limits = entitlements({ id: workspaceId }).limits;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [published] = await tx
    .select({ n: count() })
    .from(exposes)
    .where(
      and(
        eq(exposes.workspaceId, workspaceId),
        isNotNull(exposes.currentVersionId),
        isNull(exposes.unpublishedAt),
      ),
    );
  const [monthly] = await tx
    .select({ n: count() })
    .from(visits)
    .where(
      and(
        eq(visits.workspaceId, workspaceId),
        gte(visits.startedAt, monthStart),
        eq(visits.isBot, false),
        eq(visits.isInternal, false),
      ),
    );
  const [members] = await tx
    .select({ n: count() })
    .from(memberships)
    .where(eq(memberships.workspaceId, workspaceId));
  const [assetBytes] = await tx
    .select({ n: sum(assets.bytes) })
    .from(assets)
    .where(eq(assets.workspaceId, workspaceId));
  const [replayBytes] = await tx
    .select({ n: sum(sessionReplays.bytes) })
    .from(sessionReplays)
    .where(eq(sessionReplays.workspaceId, workspaceId));
  return {
    publishedExposes: usageReading(published?.n ?? 0, limits.publishedExposes),
    monthlyVisits: usageReading(monthly?.n ?? 0, limits.monthlyVisits),
    members: usageReading(members?.n ?? 0, limits.members),
    storageBytes: usageReading(
      Number(assetBytes?.n ?? 0) + Number(replayBytes?.n ?? 0),
      limits.storageBytes,
    ),
  };
}

export interface PlatformUsage {
  plan: "free" | "paid";
  databaseBytes: UsageReading;
  storageBytes: UsageReading;
  /** Null when no analytics access is configured or it failed. */
  requestsToday: UsageReading | null;
  cpuMsP99: UsageReading | null;
  cpuMsP50: number | null;
  errorsToday: number | null;
  metricsConfigured: boolean;
}

/**
 * Only platform operators see figures across all workspaces (§9a): accounts
 * listed in PLATFORM_ADMIN_EMAILS or in `platform_admins`. Nobody becomes
 * one automatically.
 */
export async function isPlatformAdmin(
  db: Database,
  user: { id: string; email: string },
): Promise<boolean> {
  if (serverEnv().PLATFORM_ADMIN_EMAILS.includes(user.email.toLowerCase())) return true;
  const [row] = await db
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, user.id));
  return Boolean(row);
}

/** Figures of the whole installation, on the system connection. */
export async function platformUsage(db: Database, now = new Date()): Promise<PlatformUsage> {
  const plan = serverEnv().HOSTING_PLAN;
  const limits = PLATFORM_LIMITS[plan];
  const size = await db.execute<{ bytes: string }>(
    sql`select pg_database_size(current_database())::text as bytes`,
  );
  const [assetBytes] = await db.select({ n: sum(assets.bytes) }).from(assets);
  const [replayBytes] = await db.select({ n: sum(sessionReplays.bytes) }).from(sessionReplays);
  const metrics = getInfra().hostingMetrics;
  const hosting = metrics ? await metrics.usageToday(now) : null;
  return {
    plan,
    databaseBytes: usageReading(Number(size[0]?.bytes ?? 0), limits.databaseBytes),
    storageBytes: usageReading(
      Number(assetBytes?.n ?? 0) + Number(replayBytes?.n ?? 0),
      limits.storageBytes,
    ),
    requestsToday: hosting ? usageReading(hosting.requestsToday, limits.requestsPerDay) : null,
    cpuMsP99: hosting ? usageReading(hosting.cpuMsP99, limits.cpuMsPerRequest) : null,
    cpuMsP50: hosting?.cpuMsP50 ?? null,
    errorsToday: hosting?.errorsToday ?? null,
    metricsConfigured: metrics !== null,
  };
}
