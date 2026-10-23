"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditLog, catalogItems, workspaceSettings } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import { billingSettingsSchema } from "@/domain/billing";
import { issuesByField } from "@/domain/chat";
import { BILLING_INTERVALS, VAT_RATES } from "@/domain/offers/schema";
import { parseEuroInput } from "@/domain/offers/totals";
import { requireCockpit } from "@/server/session";

export interface BillingSettingsState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** Settings → Angebote und Rechnungen (§7.10): tax mode, UID, default texts. */
export async function saveBillingSettings(
  _prev: BillingSettingsState,
  formData: FormData,
): Promise<BillingSettingsState> {
  const { workspace, actor, user, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const parsed = billingSettingsSchema.safeParse({
    taxMode: text(formData, "taxMode"),
    vatId: text(formData, "vatId"),
    taxNumber: text(formData, "taxNumber"),
    smallBusinessNote: text(formData, "smallBusinessNote") || undefined,
    offerValidDays: Number(text(formData, "offerValidDays")),
    offerIntro: text(formData, "offerIntro"),
    offerOutro: text(formData, "offerOutro"),
    iban: text(formData, "iban"),
    bic: text(formData, "bic"),
    bankName: text(formData, "bankName"),
    paymentTermsDays: Number(text(formData, "paymentTermsDays")),
    invoiceIntro: text(formData, "invoiceIntro"),
    invoiceOutro: text(formData, "invoiceOutro"),
    invoiceSendMode: text(formData, "invoiceSendMode") || undefined,
    invoiceEmailSubject: text(formData, "invoiceEmailSubject") || undefined,
    invoiceEmailBody: text(formData, "invoiceEmailBody") || undefined,
    dunningMode: text(formData, "dunningMode") || undefined,
    dunningDays: [1, 2, 3].map((level) => Number(text(formData, `dunningDays${level}`))),
    dunningDeadlineDays: Number(text(formData, "dunningDeadlineDays")),
    lateInterest: formData.get("lateInterest") === "on",
    collectionFee: formData.get("collectionFee") === "on",
    baseRatePercent: Number(text(formData, "baseRatePercent").trim().replace(",", ".")),
    indexNoticeDays: Number(text(formData, "indexNoticeDays")),
  });
  if (!parsed.success) {
    const errors = issuesByField(parsed.error);
    if (errors.offerValidDays) errors.offerValidDays = "Bitte 1 bis 365 Tage angeben.";
    if (errors.smallBusinessNote) errors.smallBusinessNote = "Bitte mindestens 10 Zeichen angeben.";
    if (errors.paymentTermsDays) errors.paymentTermsDays = "Bitte 0 bis 120 Tage angeben.";
    const dunningDays = Object.keys(errors).find((key) => key.startsWith("dunningDays"));
    if (dunningDays) {
      errors.dunningDays = "Bitte aufsteigende Tage von 1 bis 180 angeben.";
    }
    if (errors.dunningDeadlineDays) errors.dunningDeadlineDays = "Bitte 1 bis 60 Tage angeben.";
    if (errors.indexNoticeDays) errors.indexNoticeDays = "Bitte 0 bis 90 Tage angeben.";
    if (errors.baseRatePercent) errors.baseRatePercent = "Bitte einen Satz wie 1,53 angeben.";
    return { ok: false, message: "Bitte prüfen Sie die markierten Felder.", errors };
  }
  await tenant(async (tx) => {
    await tx
      .update(workspaceSettings)
      .set({ billing: parsed.data })
      .where(eq(workspaceSettings.workspaceId, workspace.id));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "settings.updated",
      targetType: "workspace",
      targetId: workspace.id,
      meta: { fields: ["billing"], taxMode: parsed.data.taxMode },
    });
  });
  revalidatePath("/settings");
  return { ok: true, message: "Gespeichert." };
}

const catalogSchema = z.object({
  name: z.string().trim().min(2, "Bitte einen Namen angeben.").max(160),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((value) => value || null),
  unit: z.string().trim().min(1).max(30),
  unitPriceCents: z
    .number({ error: "Bitte einen Betrag in Euro angeben." })
    .int()
    .min(0)
    .max(100_000_000),
  billing: z.enum(BILLING_INTERVALS),
  vatRate: z.coerce
    .number()
    .refine((rate) => (VAT_RATES as readonly number[]).includes(rate), "Ungültiger Steuersatz."),
});

/** Leistungskatalog: one reusable line for new offers. */
export async function addCatalogItem(
  _prev: BillingSettingsState,
  formData: FormData,
): Promise<BillingSettingsState> {
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const parsed = catalogSchema.safeParse({
    name: text(formData, "name"),
    description: text(formData, "description"),
    unit: text(formData, "unit") || "Pauschal",
    unitPriceCents: parseEuroInput(text(formData, "price")) ?? Number.NaN,
    billing: text(formData, "billing") || "once",
    vatRate: text(formData, "vatRate") || "20",
  });
  if (!parsed.success) {
    const errors = issuesByField(parsed.error);
    if (errors.unitPriceCents) errors.price = "Bitte einen Betrag in Euro angeben.";
    return { ok: false, message: "Bitte prüfen Sie die markierten Felder.", errors };
  }
  await tenant((tx) =>
    tx.insert(catalogItems).values({ workspaceId: workspace.id, ...parsed.data }),
  );
  revalidatePath("/settings");
  return { ok: true, message: `„${parsed.data.name}“ steht jetzt im Katalog.` };
}

/** Archived entries stay referenced by old offers but no longer show up for new ones. */
export async function archiveCatalogItem(formData: FormData) {
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "settings.update", { workspaceId: workspace.id });
  const id = z.uuid().parse(formData.get("id"));
  await tenant((tx) =>
    tx
      .update(catalogItems)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(catalogItems.workspaceId, workspace.id),
          eq(catalogItems.id, id),
          isNull(catalogItems.archivedAt),
        ),
      ),
  );
  revalidatePath("/settings");
}
