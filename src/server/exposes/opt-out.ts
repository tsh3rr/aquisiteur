import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { auditLog, exposes, prospects } from "@/db/schema";
import { notificationCopy } from "@/domain/notifications";
import { defer } from "@/server/defer";
import { notifyAndDispatch } from "@/server/notifications/notify";

/**
 * "Kein Interesse, bitte nicht mehr kontaktieren" (§7.3): marks the prospect
 * and blocks follow-ups. Called by an anonymous visitor, so it runs on the
 * system connection, scoped to the host's workspace and the exposé slug.
 * The owner hears about it when an „opt_out“ rule is enabled (§7.7).
 */
export async function optOutByExposeSlug(
  db: Database,
  workspaceId: string,
  slug: string,
): Promise<boolean> {
  const result = await db.transaction(async (tx) => {
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
    if (!expose) return null;
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
      .returning({ id: prospects.id, company: prospects.companyName });
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
    return { prospectId: expose.prospectId, company: updated[0]?.company ?? null };
  });
  if (!result) return false;
  const { prospectId, company } = result;
  if (company) {
    await defer(() =>
      notifyAndDispatch(db, {
        workspaceId,
        trigger: "opt_out",
        prospectId,
        groupKey: `opt_out:${prospectId}`,
        url: `/kunden/${prospectId}`,
        ...notificationCopy({ trigger: "opt_out", company }),
      }),
    );
  }
  return true;
}
