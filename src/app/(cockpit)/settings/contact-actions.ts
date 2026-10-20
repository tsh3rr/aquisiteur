"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditLog, workspaceSettings } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import { issuesByField } from "@/domain/chat";
import {
  channelsSchema,
  chatSettingsSchema,
  nudgeSettingsSchema,
} from "@/domain/workspace-settings";
import { requireCockpit } from "@/server/session";

export interface ContactSettingsState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

const formSchema = z.object({
  channels: channelsSchema,
  chat: chatSettingsSchema,
  nudges: nudgeSettingsSchema,
});

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const flag = (formData: FormData, name: string) => formData.get(name) === "on";

/** Settings → Kontakt und Chat (§7.4, §7.5). Channels, chat and nudges in one form. */
export async function saveContactSettings(
  _prev: ContactSettingsState,
  formData: FormData,
): Promise<ContactSettingsState> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const parsed = formSchema.safeParse({
    channels: {
      email: text(formData, "channels.email"),
      phone: text(formData, "channels.phone"),
      mobile: text(formData, "channels.mobile"),
      whatsapp: text(formData, "channels.whatsapp"),
      sms: text(formData, "channels.sms"),
      messengerPage: text(formData, "channels.messengerPage"),
      bookingUrl: text(formData, "channels.bookingUrl"),
    },
    chat: {
      enabled: flag(formData, "chat.enabled"),
      responseTime: text(formData, "chat.responseTime") || undefined,
      offlineMessage: text(formData, "chat.offlineMessage") || undefined,
      storeDraftContent: flag(formData, "chat.storeDraftContent"),
      prefillCallbackPhone: flag(formData, "chat.prefillCallbackPhone"),
    },
    nudges: {
      enabled: flag(formData, "nudges.enabled"),
      readInvite: flag(formData, "nudges.readInvite"),
      pricing: flag(formData, "nudges.pricing"),
      returning: flag(formData, "nudges.returning"),
      exitIntent: flag(formData, "nudges.exitIntent"),
      stickyBar: flag(formData, "nudges.stickyBar"),
    },
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Bitte prüfen Sie die markierten Felder.",
      errors: issuesByField(parsed.error),
    };
  }
  await tenant(async (tx) => {
    await tx
      .update(workspaceSettings)
      .set({ channels: parsed.data.channels, chat: parsed.data.chat, nudges: parsed.data.nudges })
      .where(eq(workspaceSettings.workspaceId, workspace.id));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "settings.updated",
      targetType: "workspace_settings",
      targetId: workspace.id,
      meta: { sections: ["channels", "chat", "nudges"] },
    });
  });
  revalidatePath("/settings");
  return { ok: true, message: "Gespeichert. Exposés zeigen die Änderung beim nächsten Aufruf." };
}
