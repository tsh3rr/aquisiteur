"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { auditLog } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import { requireCockpit } from "@/server/session";
import { deleteReplay } from "@/server/tracking/replay";

export async function deleteReplayAction(prospectId: string, replayId: string) {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "prospects.manage", { workspaceId: workspace.id });
  const id = z.uuid().parse(replayId);
  await tenant(async (tx) => {
    if (await deleteReplay(tx, workspace.id, id)) {
      await tx.insert(auditLog).values({
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "replay.deleted",
        targetType: "replay",
        targetId: id,
        meta: { prospectId },
      });
    }
  });
  redirect(`/kunden/${z.uuid().parse(prospectId)}`);
}
