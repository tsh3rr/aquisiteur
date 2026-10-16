"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, workspaceSettings, workspaces } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import { retentionSchema } from "@/domain/workspace-settings";
import { getInfra } from "@/infra";
import { ACTIVE_WORKSPACE_COOKIE, requireCockpit } from "@/server/session";

export interface DataSettingsState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

const formSchema = z.object({
  eventsDays: z.coerce.number().int(),
  replaysDays: z.coerce.number().int(),
  optOutTrackingDays: z.coerce.number().int(),
});

const BOUNDS = {
  eventsDays: "Zwischen 30 und 3650 Tagen.",
  replaysDays: "Zwischen 7 und 365 Tagen.",
  optOutTrackingDays: "Zwischen 1 und 90 Tagen.",
} as const;

/** Settings → Daten: retention periods (§9 „konfigurierbare Frist“). */
export async function saveRetentionAction(
  _prev: DataSettingsState,
  formData: FormData,
): Promise<DataSettingsState> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const raw = formSchema.safeParse(Object.fromEntries(formData));
  const parsed = raw.success ? retentionSchema.safeParse(raw.data) : raw;
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]) as keyof typeof BOUNDS;
      errors[key] = BOUNDS[key] ?? "Bitte eine ganze Zahl eingeben.";
    }
    return { ok: false, errors, message: "Bitte die markierten Felder prüfen." };
  }
  await tenant(async (tx) => {
    await tx
      .update(workspaceSettings)
      .set({ retention: parsed.data })
      .where(eq(workspaceSettings.workspaceId, workspace.id));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "settings.updated",
      targetType: "workspace",
      targetId: workspace.id,
      meta: { fields: ["retention"], ...parsed.data },
    });
  });
  revalidatePath("/settings");
  return {
    ok: true,
    message: "Gespeichert. Der stündliche Löschlauf nutzt ab jetzt diese Fristen.",
  };
}

/**
 * Deletes the workspace with all its data and files (§9a „Löschung pro
 * Workspace“). Owners only, confirmed by typing the workspace's address
 * name. Runs on the system connection like workspace creation: the tenant
 * role cannot delete its own workspace row.
 */
export async function deleteWorkspaceAction(
  _prev: DataSettingsState,
  formData: FormData,
): Promise<DataSettingsState> {
  const { workspace, actor } = await requireCockpit();
  assertCan(actor, "workspace.delete", { workspaceId: workspace.id });
  if (String(formData.get("confirm") ?? "").trim() !== workspace.slug) {
    return {
      ok: false,
      errors: { confirm: `Bitte genau „${workspace.slug}“ eingeben.` },
      message: "Nichts gelöscht.",
    };
  }
  await getInfra().storage.deletePrefix(`${workspace.id}/`);
  await getDb().delete(workspaces).where(eq(workspaces.id, workspace.id));
  (await cookies()).delete(ACTIVE_WORKSPACE_COOKIE);
  redirect("/");
}
