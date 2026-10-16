"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLog, workspaceSettings } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import { legalSchema } from "@/domain/workspace-settings";
import { requireCockpit } from "@/server/session";

export interface LegalSettingsState {
  ok: boolean;
  message?: string;
}

/** Settings → Impressum und Datenschutz (§9 „konfigurierbare Seiten“). Empty: generated text. */
export async function saveLegalAction(
  _prev: LegalSettingsState,
  formData: FormData,
): Promise<LegalSettingsState> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const parsed = legalSchema.safeParse({
    imprintMarkdown: String(formData.get("imprintMarkdown") ?? ""),
    privacyMarkdown: String(formData.get("privacyMarkdown") ?? ""),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Der Text ist zu lang (Impressum 20.000, Datenschutz 50.000 Zeichen).",
    };
  }
  await tenant(async (tx) => {
    await tx
      .update(workspaceSettings)
      .set({ legal: parsed.data })
      .where(eq(workspaceSettings.workspaceId, workspace.id));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "settings.updated",
      targetType: "workspace",
      targetId: workspace.id,
      meta: {
        fields: ["legal"],
        imprint: parsed.data.imprintMarkdown ? "custom" : "generated",
        privacy: parsed.data.privacyMarkdown ? "custom" : "generated",
      },
    });
  });
  revalidatePath("/settings");
  return { ok: true, message: "Gespeichert. Die Seiten im Exposé zeigen ab jetzt diesen Stand." };
}
