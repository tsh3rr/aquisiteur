"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditLog, exposes, workspaces } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import type { PrintableExpose } from "@/domain/expose/print";
import { loadExposeVersionForPreview } from "@/server/exposes/load";
import { printableExpose } from "@/server/exposes/print";
import { exposePath, workspacePublicOrigin } from "@/server/exposes/urls";
import { requireCockpit } from "@/server/session";

/** Takes an exposé offline (public URL answers 404) or back online. */
export async function setExposeOnline(formData: FormData): Promise<void> {
  const { actor, workspace, tenant } = await requireCockpit();
  assertCan(actor, "exposes.manage", { workspaceId: workspace.id });
  const id = z.uuid().parse(formData.get("id"));
  const online = formData.get("online") === "1";
  await tenant(async (tx) => {
    await tx
      .update(exposes)
      .set({ unpublishedAt: online ? null : new Date() })
      .where(and(eq(exposes.id, id), eq(exposes.workspaceId, workspace.id)));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: actor.userId,
      action: online ? "expose.republished" : "expose.unpublished",
      targetType: "expose",
      targetId: id,
    });
  });
  revalidatePath(`/exposes/${id}`);
  revalidatePath("/exposes");
}

/**
 * „Wieder voll anzeigen“ (§7.3): restarts the expiry clock, so the link shows
 * the full exposé again until it goes unvisited for the set number of days.
 */
export async function resetExposeExpiry(formData: FormData): Promise<void> {
  const { actor, workspace, tenant } = await requireCockpit();
  assertCan(actor, "exposes.manage", { workspaceId: workspace.id });
  const id = z.uuid().parse(formData.get("id"));
  await tenant(async (tx) => {
    await tx
      .update(exposes)
      .set({ expiryResetAt: new Date() })
      .where(and(eq(exposes.id, id), eq(exposes.workspaceId, workspace.id)));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: actor.userId,
      action: "expose.expiry_reset",
      targetType: "expose",
      targetId: id,
    });
  });
  revalidatePath(`/exposes/${id}`);
  revalidatePath("/exposes");
}

/** Input of the designed exposé PDF (§7.9) for one version, e.g. as a letter enclosure. */
export async function loadExposePdf(id: string, version?: number): Promise<PrintableExpose | null> {
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "exposes.read", { workspaceId: workspace.id });
  const exposeId = z.uuid().parse(id);
  const number = version === undefined ? undefined : z.number().int().positive().parse(version);
  return tenant(async (tx) => {
    const data = await loadExposeVersionForPreview(tx, workspace.id, exposeId, number);
    if (!data) return null;
    const [row] = await tx
      .select({ slug: workspaces.slug, unpublishedAt: exposes.unpublishedAt })
      .from(exposes)
      .innerJoin(workspaces, eq(workspaces.id, exposes.workspaceId))
      .where(and(eq(exposes.id, exposeId), eq(exposes.workspaceId, workspace.id)));
    const origin = row
      ? await workspacePublicOrigin(tx, { id: workspace.id, slug: row.slug })
      : null;
    return printableExpose(data, {
      assetBase: "/preview/assets",
      url: origin && !row?.unpublishedAt ? `${origin}${exposePath(data.expose.slug)}` : null,
    });
  });
}
