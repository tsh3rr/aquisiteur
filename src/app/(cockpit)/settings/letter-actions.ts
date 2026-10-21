"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditLog, workspaceSettings } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import { issuesByField } from "@/domain/chat";
import { letterSettingsSchema, senderAddressSchema } from "@/domain/workspace-settings";
import { requireCockpit } from "@/server/session";

export interface LetterSettingsState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

const formSchema = z.object({
  senderAddress: senderAddressSchema,
  letter: letterSettingsSchema.omit({ signatureAssetId: true }),
});

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** Euro amount as typed ("1,10") → cents; NaN for anything else. */
function cents(value: string) {
  const normalised = value.replace(/[€\s]/g, "").replace(",", ".");
  return normalised ? Math.round(Number(normalised) * 100) : Number.NaN;
}

/** Settings → Briefe (§7.9): sender, templates, follow-ups, costs. The signature has its own upload. */
export async function saveLetterSettings(
  _prev: LetterSettingsState,
  formData: FormData,
): Promise<LetterSettingsState> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const parsed = formSchema.safeParse({
    senderAddress: {
      company: text(formData, "senderAddress.company"),
      street: text(formData, "senderAddress.street"),
      postalCode: text(formData, "senderAddress.postalCode"),
      city: text(formData, "senderAddress.city"),
      country: text(formData, "senderAddress.country") || "DE",
    },
    letter: {
      subject: text(formData, "letter.subject") || undefined,
      body: text(formData, "letter.body") || undefined,
      closing: text(formData, "letter.closing") || undefined,
      qrHint: text(formData, "letter.qrHint") || undefined,
      costCents: cents(text(formData, "letter.cost")),
      followUp: {
        enabled: formData.get("letter.followUp.enabled") === "on",
        afterDays: Number(text(formData, "letter.followUp.afterDays")),
        subject: text(formData, "letter.followUp.subject") || undefined,
        body: text(formData, "letter.followUp.body") || undefined,
      },
    },
  });
  if (!parsed.success) {
    const errors = issuesByField(parsed.error);
    if (errors["letter.costCents"]) errors["letter.cost"] = "Bitte einen Betrag in Euro angeben.";
    if (errors["letter.followUp.afterDays"])
      errors["letter.followUp.afterDays"] = "Bitte eine ganze Zahl von 3 bis 90 Tagen angeben.";
    return { ok: false, message: "Bitte prüfen Sie die markierten Felder.", errors };
  }
  await tenant(async (tx) => {
    await tx
      .update(workspaceSettings)
      .set({
        senderAddress: parsed.data.senderAddress,
        // Keep the signature, which the image upload manages.
        letter: sql`${JSON.stringify(parsed.data.letter)}::jsonb || jsonb_strip_nulls(jsonb_build_object('signatureAssetId', ${workspaceSettings.letter} -> 'signatureAssetId'))`,
      })
      .where(eq(workspaceSettings.workspaceId, workspace.id));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "settings.updated",
      targetType: "workspace",
      targetId: workspace.id,
      meta: { fields: ["senderAddress", "letter"] },
    });
  });
  revalidatePath("/settings");
  return { ok: true, message: "Gespeichert." };
}
