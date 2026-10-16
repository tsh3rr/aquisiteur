"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLog, workspaceSettings } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import { requireCockpit } from "@/server/session";

export interface ReplaySettingsState {
  ok: boolean;
  message?: string;
}

/** Settings → Sitzungsaufzeichnung (§6.3): ask visitors or not. */
export async function saveReplaySettings(
  _prev: ReplaySettingsState,
  formData: FormData,
): Promise<ReplaySettingsState> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const enabled = formData.get("enabled") === "on";
  await tenant(async (tx) => {
    await tx
      .update(workspaceSettings)
      .set({ replay: { enabled } })
      .where(eq(workspaceSettings.workspaceId, workspace.id));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "settings.updated",
      targetType: "workspace",
      targetId: workspace.id,
      meta: { fields: ["replay"], enabled },
    });
  });
  revalidatePath("/settings");
  return {
    ok: true,
    message: enabled
      ? "Gespeichert. Besucher werden ab jetzt gefragt."
      : "Gespeichert. Besucher werden nicht mehr gefragt.",
  };
}
