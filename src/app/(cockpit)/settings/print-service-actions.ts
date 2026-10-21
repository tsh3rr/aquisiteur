"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { savePingenSettings, testPingenConnection } from "@/server/letters/providers";
import { requireCockpit } from "@/server/session";

export interface PrintServiceState {
  ok: boolean;
  message?: string;
}

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const inputSchema = z.object({
  enabled: z.boolean(),
  staging: z.boolean(),
  organisationId: z.string().max(100),
  clientId: z.string().max(200),
  clientSecret: z.string().max(500),
  webhookSecret: z.string().max(500),
});

/** Settings → Briefe → Druckdienst (§7.9): Pingen credentials, stored encrypted. */
export async function savePrintService(
  _prev: PrintServiceState,
  formData: FormData,
): Promise<PrintServiceState> {
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "integrations.manage", { workspaceId: workspace.id });
  const parsed = inputSchema.safeParse({
    enabled: formData.get("provider") === "pingen",
    staging: formData.get("staging") === "on",
    organisationId: text(formData, "organisationId"),
    clientId: text(formData, "clientId"),
    clientSecret: text(formData, "clientSecret"),
    webhookSecret: text(formData, "webhookSecret"),
  });
  if (!parsed.success) return { ok: false, message: "Bitte prüfen Sie die Eingaben." };
  const result = await tenant((tx) => savePingenSettings(tx, actor, parsed.data));
  if (!result.ok) return result;
  revalidatePath("/settings");
  revalidatePath("/briefe");
  return {
    ok: true,
    message: parsed.data.enabled
      ? "Gespeichert. Briefe lassen sich jetzt per Pingen versenden."
      : "Gespeichert. Sie drucken die Briefe selbst.",
  };
}

export async function testPrintService(): Promise<PrintServiceState> {
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "integrations.manage", { workspaceId: workspace.id });
  return tenant((tx) => testPingenConnection(tx, workspace.id));
}
