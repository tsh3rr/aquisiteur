/**
 * Limit overview (§5a „Limits beobachten“): pure helpers for Settings →
 * System. Platform limits are the published quotas of the hosting plans
 * this app targets (ADR-0045); workspace limits come from entitlements().
 */

export type HostingPlan = "free" | "paid";

export interface PlatformLimits {
  /** Worker requests per day (UTC). null: billed, not capped. */
  requestsPerDay: number | null;
  /** CPU time per request in milliseconds, compared with the p99. */
  cpuMsPerRequest: number;
  /** Postgres database size in bytes. */
  databaseBytes: number;
  /** Object storage in bytes (images, recordings). null: billed, not capped. */
  storageBytes: number | null;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Cloudflare Workers, Supabase and R2 as of 2026; see docs/HOSTING.md. */
export const PLATFORM_LIMITS: Record<HostingPlan, PlatformLimits> = {
  free: {
    requestsPerDay: 100_000,
    cpuMsPerRequest: 10,
    databaseBytes: 500 * MB,
    storageBytes: 10 * GB,
  },
  paid: {
    requestsPerDay: null,
    cpuMsPerRequest: 30_000,
    databaseBytes: 8 * GB,
    storageBytes: null,
  },
};

/** From this share of a limit on, the overview warns (§5a: „warnt ab 80 %“). */
export const WARN_RATIO = 0.8;

export type UsageLevel = "unlimited" | "ok" | "warning" | "exceeded";

export interface UsageReading {
  used: number;
  limit: number | null;
  /** 0..1+ of the limit, null when unlimited. */
  ratio: number | null;
  level: UsageLevel;
}

export function usageReading(used: number, limit: number | null): UsageReading {
  if (limit === null || limit <= 0) return { used, limit: null, ratio: null, level: "unlimited" };
  const ratio = used / limit;
  const level = ratio >= 1 ? "exceeded" : ratio >= WARN_RATIO ? "warning" : "ok";
  return { used, limit, ratio, level };
}

/** "1,2 MB" style, German number format, binary units. */
export function formatBytes(bytes: number): string {
  const units = ["Byte", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: digits })} ${units[unit]}`;
}
