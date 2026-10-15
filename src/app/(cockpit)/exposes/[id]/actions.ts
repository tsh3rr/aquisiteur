"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditLog, exposes } from "@/db/schema";
import { assertCan } from "@/domain/authz";
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
