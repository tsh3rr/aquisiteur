import "server-only";
import type { Database } from "@/db";
import { crossedThresholds, notificationCopy } from "@/domain/notifications";
import { recomputeIntent } from "@/server/intent/recompute";
import {
  dispatch,
  notify,
  scoreThresholds,
  type NotifyInput,
  type Pending,
} from "@/server/notifications/notify";
import { publish, workspaceTopic } from "@/server/realtime";

/**
 * After every signal (§7.6, §7.7): record the event's own notification,
 * recompute the score, notify when it passes a threshold, then deliver.
 * A chat message or callback already notifies, so the score jump it causes
 * does not send a second push: one moment, one notification.
 */
export async function processProspect(
  db: Database,
  input: { workspaceId: string; prospectId: string; cause?: NotifyInput | null },
  now = new Date(),
): Promise<Pending[]> {
  const pending: Pending[] = [];
  if (input.cause) {
    const caused = await notify(db, input.cause, now);
    if (caused) pending.push(caused);
  }

  const recomputed = await recomputeIntent(db, input.workspaceId, input.prospectId, now);
  if (recomputed) {
    const { before, result, company } = recomputed;
    if (before !== result.score) {
      await publish([workspaceTopic(input.workspaceId)], "intent.updated", {
        prospectId: input.prospectId,
        score: result.score,
        level: result.level,
      });
    }
    const crossed = crossedThresholds(
      before,
      result.score,
      await scoreThresholds(db, input.workspaceId),
    );
    const contactNotified = pending.some(
      (p) =>
        !p.update &&
        (input.cause?.trigger === "chat_message" || input.cause?.trigger === "callback"),
    );
    const threshold = Math.max(...crossed);
    if (crossed.length > 0 && !contactNotified) {
      const copy = notificationCopy({
        trigger: "score_threshold",
        company,
        headline: result.explanation.headline,
        recommendation: result.explanation.recommendation,
      });
      const scored = await notify(
        db,
        {
          workspaceId: input.workspaceId,
          trigger: "score_threshold",
          prospectId: input.prospectId,
          groupKey: `score:${input.prospectId}:${threshold}`,
          threshold,
          url: `/kunden/${input.prospectId}`,
          ...copy,
        },
        now,
      );
      if (scored) pending.push(scored);
    }
  }

  for (const item of pending) await dispatch(db, item);
  return pending;
}
