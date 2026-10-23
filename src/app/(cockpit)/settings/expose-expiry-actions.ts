"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditLog, workspaceSettings } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import { exposeExpirySchema } from "@/domain/workspace-settings";
import { requireCockpit } from "@/server/session";

export interface ExposeExpiryState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

const formSchema = z.object({ afterDays: z.coerce.number().int() });

/** Settings → Exposés: after how many quiet days an exposé turns into its short page (§7.3). */
export async function saveExposeExpiry(
  _prev: ExposeExpiryState,
  formData: FormData,
): Promise<ExposeExpiryState> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const raw = formSchema.safeParse(Object.fromEntries(formData));
  const parsed = raw.success
    ? exposeExpirySchema.safeParse({
        enabled: formData.get("enabled") === "on",
        afterDays: raw.data.afterDays,
      })
    : raw;
  if (!parsed.success) {
    return {
      ok: false,
      errors: { afterDays: "Zwischen 7 und 365 Tagen." },
      message: "Bitte die markierten Felder prüfen.",
    };
  }
  await tenant(async (tx) => {
    await tx
      .update(workspaceSettings)
      .set({ exposeExpiry: parsed.data })
      .where(eq(workspaceSettings.workspaceId, workspace.id));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "settings.updated",
      targetType: "workspace",
      targetId: workspace.id,
      meta: { fields: ["exposeExpiry"], ...parsed.data },
    });
  });
  revalidatePath("/settings");
  revalidatePath("/exposes");
  return {
    ok: true,
    message: parsed.data.enabled
      ? `Gespeichert. Exposés laufen nach ${parsed.data.afterDays} ruhigen Tagen ab.`
      : "Gespeichert. Exposés laufen nicht mehr ab.",
  };
}
