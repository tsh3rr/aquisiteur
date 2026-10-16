import "server-only";
import { eq } from "drizzle-orm";
import type { Transaction } from "@/db";
import { auditLog, contacts, prospects } from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { duplicateKey, type ImportRow } from "@/domain/prospects/import";
import { createProspect } from "./mutations";

export interface ImportResult {
  created: number;
  duplicates: { line: number; companyName: string }[];
}

/**
 * Creates prospects from validated CSV rows (§7.1). A company that already
 * exists at the same place (or twice in the file) is skipped, so importing
 * the same list again does no harm.
 */
export async function importProspects(
  tx: Transaction,
  actor: Actor,
  rows: ImportRow[],
  campaignId: string | null,
): Promise<ImportResult> {
  const existing = await tx
    .select({ companyName: prospects.companyName, city: prospects.city })
    .from(prospects)
    .where(eq(prospects.workspaceId, actor.workspaceId));
  const known = new Set(existing.map(duplicateKey));
  const result: ImportResult = { created: 0, duplicates: [] };
  for (const row of rows) {
    const key = duplicateKey(row.prospect);
    if (known.has(key)) {
      result.duplicates.push({ line: row.line, companyName: row.prospect.companyName });
      continue;
    }
    known.add(key);
    const id = await createProspect(
      tx,
      actor,
      { ...row.prospect, campaignId: row.prospect.campaignId ?? campaignId },
      { audit: false },
    );
    if (row.contact) {
      await tx.insert(contacts).values({
        workspaceId: actor.workspaceId,
        prospectId: id,
        ...row.contact,
        isPrimary: true,
      });
    }
    result.created += 1;
  }
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "prospect.imported",
    targetType: "campaign",
    targetId: campaignId,
    meta: { created: result.created, duplicates: result.duplicates.length },
  });
  return result;
}
