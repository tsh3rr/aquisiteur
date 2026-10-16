import "server-only";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { Transaction } from "@/db";
import { auditLog, campaigns, letters, prospects } from "@/db/schema";
import type { Actor } from "@/domain/authz";

/** Campaigns (§7.1). Always inside withTenant. */

export interface CampaignItem {
  id: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  prospects: number;
  createdAt: Date;
}

export async function listCampaigns(
  tx: Transaction,
  workspaceId: string,
  options: { includeArchived?: boolean } = {},
): Promise<CampaignItem[]> {
  return tx
    .select({
      id: campaigns.id,
      name: campaigns.name,
      description: campaigns.description,
      archivedAt: campaigns.archivedAt,
      createdAt: campaigns.createdAt,
      prospects: count(prospects.id),
    })
    .from(campaigns)
    .leftJoin(
      prospects,
      and(eq(prospects.workspaceId, campaigns.workspaceId), eq(prospects.campaignId, campaigns.id)),
    )
    .where(
      and(
        eq(campaigns.workspaceId, workspaceId),
        options.includeArchived ? undefined : isNull(campaigns.archivedAt),
      ),
    )
    .groupBy(campaigns.id)
    .orderBy(asc(campaigns.archivedAt), asc(campaigns.name));
}

export async function getCampaign(tx: Transaction, workspaceId: string, id: string) {
  const [row] = await tx
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, id)));
  return row ?? null;
}

/** Null when the name is taken. */
export async function createCampaign(
  tx: Transaction,
  actor: Actor,
  input: { name: string; description: string | null },
): Promise<string | null> {
  const [row] = await tx
    .insert(campaigns)
    .values({ workspaceId: actor.workspaceId, ...input })
    .onConflictDoNothing()
    .returning({ id: campaigns.id });
  if (!row) return null;
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "campaign.created",
    targetType: "campaign",
    targetId: row.id,
    meta: { name: input.name },
  });
  return row.id;
}

/** "taken" when another campaign has the name. */
export async function updateCampaign(
  tx: Transaction,
  actor: Actor,
  id: string,
  input: { name: string; description: string | null; archived?: boolean },
): Promise<"ok" | "missing" | "taken"> {
  const [clash] = await tx
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, actor.workspaceId), eq(campaigns.name, input.name)));
  if (clash && clash.id !== id) return "taken";
  const updated = await tx
    .update(campaigns)
    .set({
      name: input.name,
      description: input.description,
      ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
    })
    .where(and(eq(campaigns.workspaceId, actor.workspaceId), eq(campaigns.id, id)))
    .returning({ id: campaigns.id });
  return updated.length > 0 ? "ok" : "missing";
}

/** Deletes a campaign; its prospects and letters stay, without campaign. */
export async function deleteCampaign(tx: Transaction, actor: Actor, id: string) {
  const scope = (table: typeof prospects | typeof letters) =>
    and(eq(table.workspaceId, actor.workspaceId), eq(table.campaignId, id));
  await tx.update(prospects).set({ campaignId: null }).where(scope(prospects));
  await tx.update(letters).set({ campaignId: null }).where(scope(letters));
  const deleted = await tx
    .delete(campaigns)
    .where(and(eq(campaigns.workspaceId, actor.workspaceId), eq(campaigns.id, id)))
    .returning({ name: campaigns.name });
  if (deleted[0]) {
    await tx.insert(auditLog).values({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: "campaign.deleted",
      targetType: "campaign",
      targetId: id,
      meta: { name: deleted[0].name },
    });
  }
  return deleted.length > 0;
}

/** Puts prospects into a campaign (or none). Returns how many changed. */
export async function assignCampaign(
  tx: Transaction,
  actor: Actor,
  ids: string[],
  campaignId: string | null,
): Promise<number> {
  if (ids.length === 0) return 0;
  if (campaignId && !(await getCampaign(tx, actor.workspaceId, campaignId))) return 0;
  const updated = await tx
    .update(prospects)
    .set({ campaignId })
    .where(and(eq(prospects.workspaceId, actor.workspaceId), inArray(prospects.id, ids)))
    .returning({ id: prospects.id });
  return updated.length;
}
