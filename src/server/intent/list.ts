import "server-only";
import { and, desc, eq, gt, gte, isNull } from "drizzle-orm";
import type { Transaction } from "@/db";
import { intentScores, prospects } from "@/db/schema";
import type { Explanation } from "@/domain/intent/explain";
import type { IntentLevel } from "@/domain/intent/score";

export interface HotProspect {
  prospectId: string;
  company: string;
  score: number;
  level: IntentLevel;
  explanation: Explanation;
  lastSignalAt: Date | null;
}

/** „Wer braucht jetzt eine Reaktion“ (§7.6): recent signals, highest score first. */
export async function listHotProspects(
  tx: Transaction,
  workspaceId: string,
  options: { days?: number; minScore?: number; limit?: number } = {},
  now = new Date(),
): Promise<HotProspect[]> {
  const since = new Date(now.getTime() - (options.days ?? 7) * 24 * 60 * 60 * 1000);
  return tx
    .select({
      prospectId: intentScores.prospectId,
      company: prospects.companyName,
      score: intentScores.score,
      level: intentScores.level,
      explanation: intentScores.explanation,
      lastSignalAt: intentScores.lastSignalAt,
    })
    .from(intentScores)
    .innerJoin(
      prospects,
      and(
        eq(prospects.workspaceId, intentScores.workspaceId),
        eq(prospects.id, intentScores.prospectId),
      ),
    )
    .where(
      and(
        eq(intentScores.workspaceId, workspaceId),
        gte(intentScores.lastSignalAt, since),
        gt(intentScores.score, options.minScore ?? 0),
        isNull(prospects.doNotContactAt),
      ),
    )
    .orderBy(desc(intentScores.score), desc(intentScores.lastSignalAt))
    .limit(options.limit ?? 10);
}

export async function loadIntent(tx: Transaction, workspaceId: string, prospectId: string) {
  const [row] = await tx
    .select()
    .from(intentScores)
    .where(and(eq(intentScores.workspaceId, workspaceId), eq(intentScores.prospectId, prospectId)));
  return row ?? null;
}
