import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { auditLog, exposes, prospects } from "@/db/schema";

/**
 * "Kein Interesse, bitte nicht mehr kontaktieren" (§7.3): marks the prospect
 * and blocks follow-ups. Called by an anonymous visitor, so it runs on the
 * system connection, scoped to the host's workspace and the exposé slug.
 * Notifying the owner arrives with the notification engine (phase 4).
 */
export async function optOutByExposeSlug(
  db: Database,
  workspaceId: string,
  slug: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [expose] = await tx
      .select({ id: exposes.id, prospectId: exposes.prospectId })
      .from(exposes)
      .where(
        and(
          eq(exposes.workspaceId, workspaceId),
          eq(exposes.slug, slug),
          isNull(exposes.unpublishedAt),
        ),
      );
    if (!expose) return false;
    const updated = await tx
      .update(prospects)
      .set({ status: "no_interest", doNotContactAt: new Date() })
      .where(
        and(
          eq(prospects.id, expose.prospectId),
          eq(prospects.workspaceId, workspaceId),
          isNull(prospects.doNotContactAt),
        ),
      )
      .returning({ id: prospects.id });
    if (updated.length > 0) {
      await tx.insert(auditLog).values({
        workspaceId,
        actorUserId: null,
        action: "prospect.opted_out",
        targetType: "prospect",
        targetId: expose.prospectId,
        meta: { exposeId: expose.id, via: "expose" },
      });
    }
    return true;
  });
}
