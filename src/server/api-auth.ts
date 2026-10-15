import "server-only";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { getDb, withTenant, type Transaction } from "@/db";
import { apiTokens, memberships } from "@/db/schema";
import { bearerToken, hashApiToken } from "@/domain/api-tokens";
import type { Actor } from "@/domain/authz";

export interface ApiContext {
  actor: Actor;
  tokenId: string;
  tenant: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
}

/**
 * Authenticates a workspace API token (§9a: CLI/API per workspace token).
 * The token acts with the rights of the member who created it; it stops
 * working when it is revoked, expires, or that person leaves the workspace.
 * Lookup runs on the system connection because no tenant is known yet.
 */
export async function authenticateApiRequest(request: Request): Promise<ApiContext | null> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return null;
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select({
      id: apiTokens.id,
      workspaceId: apiTokens.workspaceId,
      userId: apiTokens.createdByUserId,
      role: memberships.role,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .innerJoin(
      memberships,
      and(
        eq(memberships.workspaceId, apiTokens.workspaceId),
        eq(memberships.userId, apiTokens.createdByUserId),
      ),
    )
    .where(
      and(
        eq(apiTokens.tokenHash, await hashApiToken(token)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
    .limit(1);
  if (!row?.userId) return null;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiTokens.id, row.id),
          or(
            isNull(apiTokens.lastUsedAt),
            lt(apiTokens.lastUsedAt, new Date(now.getTime() - 60_000)),
          ),
        ),
      );
  }

  const userId = row.userId;
  return {
    actor: { userId, role: row.role, workspaceId: row.workspaceId },
    tokenId: row.id,
    tenant: (fn) => withTenant(db, { userId, workspaceId: row.workspaceId }, fn),
  };
}

export function apiError(status: number, error: string, issues?: unknown): Response {
  return Response.json(
    { error, ...(issues ? { issues } : {}) },
    { status, headers: { "cache-control": "no-store" } },
  );
}
