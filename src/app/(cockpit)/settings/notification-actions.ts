"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditLog, workspaceSettings } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import { issuesByField } from "@/domain/chat";
import { DEFAULT_WEIGHTS, type WeightedSignalId } from "@/domain/intent/score";
import { ruleInputSchema } from "@/domain/notifications";
import { timezoneSchema } from "@/domain/workspace-settings";
import {
  deleteRule,
  recomputeAllScores,
  removePushSubscription,
  savePushSubscription,
  saveRule,
  sendTestPush,
  setRuleEnabled,
} from "@/server/notifications/manage";
import { requireCockpit } from "@/server/session";

export interface FormState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** Settings → Benachrichtigungen: add or edit one rule (§7.7). */
export async function saveRuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const parsed = ruleInputSchema.safeParse({
    trigger: text(formData, "trigger"),
    threshold: text(formData, "threshold") || undefined,
    channels: formData.getAll("channels"),
    enabled: true,
    quietFrom: text(formData, "quietFrom"),
    quietTo: text(formData, "quietTo"),
    weekdaysOnly: formData.get("weekdaysOnly") === "on",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Bitte prüfen Sie die markierten Felder.",
      errors: issuesByField(parsed.error),
    };
  }
  const id = text(formData, "id") || undefined;
  const saved = await tenant((tx) =>
    saveRule(tx, { workspaceId: workspace.id, userId: user.id, id, rule: parsed.data }),
  );
  if (!saved) return { ok: false, message: "Diese Regel gibt es nicht mehr." };
  revalidatePath("/settings");
  return { ok: true, message: id ? "Regel gespeichert." : "Regel hinzugefügt." };
}

export async function toggleRuleAction(id: string, enabled: boolean) {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  await tenant((tx) =>
    setRuleEnabled(tx, { workspaceId: workspace.id, userId: user.id, id, enabled }),
  );
  revalidatePath("/settings");
}

export async function deleteRuleAction(id: string) {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  await tenant((tx) => deleteRule(tx, { workspaceId: workspace.id, userId: user.id, id }));
  revalidatePath("/settings");
}

const subscriptionSchema = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(64) }),
  label: z.string().trim().max(80).nullable(),
});

/** „Push auf diesem Gerät aktivieren“: each member manages their own devices. */
export async function subscribePushAction(input: unknown): Promise<{ ok: boolean }> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "workspace.read", { workspaceId: workspace.id });
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.endpoint.startsWith("https://")) return { ok: false };
  await tenant((tx) =>
    savePushSubscription(tx, {
      workspaceId: workspace.id,
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      label: parsed.data.label,
    }),
  );
  revalidatePath("/settings");
  return { ok: true };
}

export async function removePushDeviceAction(input: { id?: string; endpoint?: string }) {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "workspace.read", { workspaceId: workspace.id });
  await tenant((tx) =>
    removePushSubscription(tx, {
      workspaceId: workspace.id,
      userId: user.id,
      id: typeof input.id === "string" ? input.id : undefined,
      endpoint: typeof input.endpoint === "string" ? input.endpoint : undefined,
    }),
  );
  revalidatePath("/settings");
}

export async function sendTestPushAction(): Promise<string> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "workspace.read", { workspaceId: workspace.id });
  const result = await tenant((tx) => sendTestPush(tx, workspace.id, user.id));
  if (result.devices === 0) return "Noch kein Gerät aktiviert.";
  return result.delivered > 0
    ? `Test an ${result.delivered === 1 ? "ein Gerät" : `${result.delivered} Geräte`} gesendet.`
    : "Der Push-Dienst hat den Test abgelehnt. Bitte aktivieren Sie das Gerät neu.";
}

/** Settings → Kontaktabsicht: time zone and the signal weights (§7.6). */
export async function saveScoreSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const errors: Record<string, string> = {};
  const weights: Partial<Record<WeightedSignalId, number>> = {};
  for (const id of Object.keys(DEFAULT_WEIGHTS) as WeightedSignalId[]) {
    const raw = text(formData, `weight.${id}`);
    const value = Number(raw);
    if (raw === "" || !Number.isInteger(value) || value < 0 || value > 99) {
      errors[`weight.${id}`] = "Bitte eine ganze Zahl von 0 bis 99 angeben.";
      continue;
    }
    // Only store what differs from the default, so later default changes still apply.
    if (value !== Math.round(DEFAULT_WEIGHTS[id] * 100)) weights[id] = value / 100;
  }
  const timezone = text(formData, "timezone");
  const zone = timezoneSchema.safeParse(timezone);
  if (!zone.success) errors.timezone = "Unbekannte Zeitzone, z. B. Europe/Berlin.";
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "Bitte prüfen Sie die markierten Felder.", errors };
  }
  const count = await tenant(async (tx) => {
    await tx
      .update(workspaceSettings)
      .set({ scoreWeights: weights, notifications: { timezone } })
      .where(eq(workspaceSettings.workspaceId, workspace.id));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "settings.updated",
      targetType: "workspace_settings",
      targetId: workspace.id,
      meta: { sections: ["scoreWeights", "notifications"] },
    });
    return recomputeAllScores(tx, workspace.id);
  });
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Gespeichert. ${count === 1 ? "Ein Score wurde" : `${count} Scores wurden`} neu berechnet.`,
  };
}
