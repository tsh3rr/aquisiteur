"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PrintableLetterData } from "@/components/letters/types";
import { assertCan } from "@/domain/authz";
import { LETTER_KINDS } from "@/domain/letters/lifecycle";
import {
  advanceLetters,
  createLetters,
  deleteDraftLetters,
  loadPrintableLetters,
  MAX_LETTERS_PER_BATCH,
  SKIP_LABELS,
} from "@/server/letters/manage";
import { requireCockpit } from "@/server/session";

async function manager() {
  const context = await requireCockpit();
  assertCan(context.actor, "prospects.manage", { workspaceId: context.workspace.id });
  return context;
}

const idsSchema = z.array(z.uuid()).min(1).max(MAX_LETTERS_PER_BATCH);

function revalidateLetters() {
  revalidatePath("/briefe");
  revalidatePath("/kunden");
  revalidatePath("/kampagnen");
}

export interface CreateState {
  ok: boolean;
  message?: string;
}

export async function createLettersAction(
  _: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const { actor, tenant } = await manager();
  const ids = idsSchema.safeParse(
    String(formData.get("ids") ?? "")
      .split(",")
      .filter(Boolean),
  );
  const kind = z.enum(LETTER_KINDS).safeParse(formData.get("kind"));
  if (!ids.success || !kind.success) return { ok: false, message: "Bitte Kunden auswählen." };
  const result = await tenant((tx) =>
    createLetters(tx, actor, {
      prospectIds: ids.data,
      kind: kind.data,
      options: {
        color: formData.get("color") === "on",
        duplex: formData.get("duplex") === "on",
        teaser: formData.get("teaser") === "on",
      },
    }),
  );
  if (result.created.length === 0) {
    const reasons = [...new Set(result.skipped.map((skip) => SKIP_LABELS[skip.reason]))];
    return { ok: false, message: `Kein Brief erstellt: ${reasons.join(", ")}.` };
  }
  revalidateLetters();
  const params = new URLSearchParams({ neu: result.created.join(",") });
  if (result.skipped.length > 0) params.set("uebersprungen", String(result.skipped.length));
  redirect(`/briefe?${params.toString()}`);
}

/** Layout data for the PDF, which the browser renders. */
export async function printableLettersAction(ids: string[]): Promise<PrintableLetterData[]> {
  const { workspace, tenant } = await manager();
  const parsed = idsSchema.parse(ids);
  return tenant((tx) => loadPrintableLetters(tx, workspace.id, parsed));
}

export interface BulkState {
  ok: boolean;
  message: string;
}

const dateSchema = z.iso.date();

export async function markPostedAction(ids: string[], date: string): Promise<BulkState> {
  const { actor, tenant } = await manager();
  const parsed = idsSchema.safeParse(ids);
  const day = dateSchema.safeParse(date);
  if (!parsed.success || !day.success) return { ok: false, message: "Ungültige Auswahl." };
  // Noon local time keeps the day stable in every time zone the owner might be in.
  const at = new Date(`${day.data}T12:00:00`);
  if (at.getTime() > Date.now() + 24 * 3600 * 1000) {
    return { ok: false, message: "Das Versanddatum liegt in der Zukunft." };
  }
  const result = await tenant((tx) => advanceLetters(tx, actor, parsed.data, "posted", at));
  revalidateLetters();
  return summary(result, "als versendet markiert");
}

export async function markReturnedAction(ids: string[]): Promise<BulkState> {
  const { actor, tenant } = await manager();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, message: "Ungültige Auswahl." };
  const result = await tenant((tx) => advanceLetters(tx, actor, parsed.data, "returned"));
  revalidateLetters();
  return summary(result, "als zurückgekommen markiert");
}

export async function cancelLettersAction(ids: string[]): Promise<BulkState> {
  const { actor, tenant } = await manager();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, message: "Ungültige Auswahl." };
  const result = await tenant(async (tx) => {
    const deleted = await deleteDraftLetters(tx, actor, parsed.data);
    const cancelled = await advanceLetters(tx, actor, parsed.data, "cancelled");
    return { changed: deleted + cancelled.changed, refused: cancelled.refused - deleted };
  });
  revalidateLetters();
  return summary(result, "verworfen");
}

function summary(result: { changed: number; refused: number }, verb: string): BulkState {
  const changed = `${result.changed} ${result.changed === 1 ? "Brief" : "Briefe"} ${verb}.`;
  const refused =
    result.refused > 0
      ? ` ${result.refused} ${result.refused === 1 ? "Brief passte" : "Briefe passten"} nicht zum Status.`
      : "";
  return {
    ok: result.changed > 0,
    message: result.changed > 0 ? changed + refused : refused.trim(),
  };
}
