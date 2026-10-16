"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { IMPORT_FIELD_LABELS, previewImport } from "@/domain/prospects/import";
import { campaignFormSchema } from "@/domain/prospects/schema";
import { createCampaign, getCampaign } from "@/server/campaigns";
import { importProspects } from "@/server/prospects/import";
import { requireCockpit } from "@/server/session";

const MAX_BYTES = 2 * 1024 * 1024;

export interface PreviewState {
  ok: boolean;
  message?: string;
  columns?: { header: string; field: string | null }[];
  valid?: number;
  sample?: { line: number; companyName: string; city: string | null; contact: string | null }[];
  problems?: { line: number; message: string }[];
}

async function manager() {
  const context = await requireCockpit();
  assertCan(context.actor, "prospects.manage", { workspaceId: context.workspace.id });
  return context;
}

/** Checks the file and shows what would be imported; writes nothing. */
export async function previewImportAction(text: string, headers: string[]): Promise<PreviewState> {
  await manager();
  if (text.length > MAX_BYTES) return { ok: false, message: "Die Datei ist größer als 2 MB." };
  const preview = previewImport(text);
  return {
    ok: preview.rows.length > 0,
    message:
      preview.rows.length === 0
        ? (preview.problems[0]?.message ?? "Keine gültigen Zeilen gefunden.")
        : undefined,
    columns: headers.map((header, index) => {
      const field = preview.fields[index];
      return { header, field: field ? IMPORT_FIELD_LABELS[field] : null };
    }),
    valid: preview.rows.length,
    sample: preview.rows.slice(0, 8).map((row) => ({
      line: row.line,
      companyName: row.prospect.companyName,
      city: row.prospect.city,
      contact: row.contact
        ? [row.contact.firstName, row.contact.lastName].filter(Boolean).join(" ")
        : null,
    })),
    problems: preview.problems.slice(0, 50),
  };
}

export interface ImportState {
  ok: boolean;
  message: string;
  campaignId?: string | null;
}

const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("existing"), id: z.uuid() }),
  z.object({ kind: z.literal("new"), name: campaignFormSchema.shape.name }),
]);

export async function importAction(
  text: string,
  target: z.input<typeof targetSchema>,
): Promise<ImportState> {
  const { actor, tenant } = await manager();
  if (text.length > MAX_BYTES) return { ok: false, message: "Die Datei ist größer als 2 MB." };
  const parsedTarget = targetSchema.safeParse(target);
  if (!parsedTarget.success) {
    return { ok: false, message: "Bitte einen Namen für die neue Kampagne angeben." };
  }
  const preview = previewImport(text);
  if (preview.rows.length === 0) return { ok: false, message: "Keine gültigen Zeilen gefunden." };
  const result = await tenant(async (tx) => {
    let campaignId: string | null = null;
    const chosen = parsedTarget.data;
    if (chosen.kind === "existing") {
      if (!(await getCampaign(tx, actor.workspaceId, chosen.id))) return "missing" as const;
      campaignId = chosen.id;
    } else if (chosen.kind === "new") {
      campaignId = await createCampaign(tx, actor, { name: chosen.name, description: null });
      if (!campaignId) return "taken" as const;
    }
    return { campaignId, ...(await importProspects(tx, actor, preview.rows, campaignId)) };
  });
  if (result === "missing") return { ok: false, message: "Kampagne nicht gefunden." };
  if (result === "taken") {
    return { ok: false, message: "Eine Kampagne mit diesem Namen gibt es schon." };
  }
  revalidatePath("/kunden");
  revalidatePath("/kampagnen");
  const created = `${result.created} ${result.created === 1 ? "Kunde" : "Kunden"} importiert.`;
  const skipped =
    result.duplicates.length > 0
      ? ` ${result.duplicates.length} übersprungen, weil es sie schon gibt.`
      : "";
  const invalid =
    preview.problems.length > 0
      ? ` ${preview.problems.length} Zeilen mit Fehlern ausgelassen.`
      : "";
  return { ok: true, message: created + skipped + invalid, campaignId: result.campaignId };
}
