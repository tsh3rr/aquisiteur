import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "@/db";
import { memberPresence } from "@/db/schema";
import { isAvailable } from "@/domain/chat";

/**
 * „Verfügbar“ (§7.4): cockpit tabs report in every minute; a member can
 * also set the status by hand.
 */
export type Availability = "auto" | "available" | "away";

/** Public: is anyone of this workspace reachable right now? System connection, scoped. */
export async function workspaceAvailable(db: Database, workspaceId: string): Promise<boolean> {
  const rows = await db
    .select({
      availability: memberPresence.availability,
      lastActiveAt: memberPresence.lastActiveAt,
    })
    .from(memberPresence)
    .where(eq(memberPresence.workspaceId, workspaceId));
  return isAvailable(rows);
}

/** A cockpit tab of this member is open. */
export async function presenceBeat(tx: Transaction, workspaceId: string, userId: string) {
  await tx
    .insert(memberPresence)
    .values({ workspaceId, userId, lastActiveAt: new Date() })
    .onConflictDoUpdate({
      target: [memberPresence.workspaceId, memberPresence.userId],
      set: { lastActiveAt: sql`now()` },
    });
}

export async function setAvailability(
  tx: Transaction,
  workspaceId: string,
  userId: string,
  availability: Availability,
) {
  await tx
    .insert(memberPresence)
    .values({ workspaceId, userId, availability })
    .onConflictDoUpdate({
      target: [memberPresence.workspaceId, memberPresence.userId],
      set: { availability, lastActiveAt: sql`now()` },
    });
}

export async function loadAvailability(
  tx: Transaction,
  workspaceId: string,
  userId: string,
): Promise<Availability> {
  const [row] = await tx
    .select({ availability: memberPresence.availability })
    .from(memberPresence)
    .where(and(eq(memberPresence.workspaceId, workspaceId), eq(memberPresence.userId, userId)));
  return row?.availability ?? "auto";
}
