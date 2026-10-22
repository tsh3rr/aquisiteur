import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@/db";
import { auditLog, prospects } from "@/db/schema";
import type { ProspectStatus } from "@/domain/prospects/status";

/**
 * Automatic status changes (§7.1): a posted letter marks „Brief versendet“,
 * the first real visit opens, a chat message or callback request means contact, an accepted offer
 * means won (§7.10). Only moves forward from the listed statuses; anything the owner set later stays.
 */
const AUTO_TRANSITIONS = {
  letter_sent: ["draft"],
  opened: ["draft", "letter_sent"],
  contacted: ["draft", "letter_sent", "opened", "interested"],
  won: ["draft", "letter_sent", "opened", "interested", "contacted", "meeting", "lost"],
} as const satisfies Partial<Record<ProspectStatus, readonly ProspectStatus[]>>;

export async function advanceStatus(
  tx: Transaction,
  input: {
    workspaceId: string;
    prospectId: string;
    to: keyof typeof AUTO_TRANSITIONS;
    via: "visit" | "chat" | "callback" | "letter" | "offer";
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  const from = AUTO_TRANSITIONS[input.to];
  const [prospect] = await tx
    .select({ status: prospects.status })
    .from(prospects)
    .where(
      and(
        eq(prospects.workspaceId, input.workspaceId),
        eq(prospects.id, input.prospectId),
        inArray(prospects.status, [...from]),
      ),
    )
    .for("update");
  if (!prospect) return;
  await tx
    .update(prospects)
    .set({ status: input.to })
    .where(and(eq(prospects.workspaceId, input.workspaceId), eq(prospects.id, input.prospectId)));
  await tx.insert(auditLog).values({
    workspaceId: input.workspaceId,
    actorUserId: null,
    action: "prospect.status_changed",
    targetType: "prospect",
    targetId: input.prospectId,
    meta: { from: prospect.status, to: input.to, via: input.via, ...input.meta },
  });
}
