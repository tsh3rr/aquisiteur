import "server-only";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { withTenant, type Database } from "@/db";
import { letters, memberships, prospects, tasks } from "@/db/schema";
import {
  FOLLOW_UP_TASK_TITLE,
  FOLLOW_UP_WINDOW_DAYS,
  followUpDecision,
  followUpTaskNote,
} from "@/domain/letters/follow-up";
import { localDateString } from "@/domain/tasks";
import { createLetters } from "@/server/letters/manage";
import { createTask } from "@/server/tasks";
import { loadWorkspaceSettings } from "@/server/workspaces";

const DAY = 24 * 3600 * 1000;
/** The largest `afterDays` the settings allow, plus the window. */
const OLDEST_DAYS = 90 + FOLLOW_UP_WINDOW_DAYS;
const NEWEST_DAYS = 3;

/**
 * Hourly job (§7.9 „Automatischer Follow-up-Versand“): for first letters that
 * brought no visit, prepares a follow-up draft with its own code and a task
 * „Folgebrief drucken und versenden“ that reminds right away. Finds candidates
 * across workspaces on the system connection; the letter and task are written
 * inside withTenant as the workspace's owner. Nothing is sent by itself.
 * A first letter is followed up at most once (`follow_up_at`), so a draft the
 * owner deletes stays deleted; a letter past the window is settled the same way.
 */
export async function runAutoFollowUps(db: Database, now = new Date()) {
  const candidates = await db
    .select({
      id: letters.id,
      workspaceId: letters.workspaceId,
      prospectId: letters.prospectId,
      postedAt: letters.postedAt,
    })
    .from(letters)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, letters.workspaceId), eq(prospects.id, letters.prospectId)),
    )
    .where(
      and(
        eq(letters.kind, "initial"),
        eq(letters.status, "posted"),
        isNull(letters.followUpAt),
        gte(letters.postedAt, new Date(now.getTime() - OLDEST_DAYS * DAY)),
        lte(letters.postedAt, new Date(now.getTime() - NEWEST_DAYS * DAY)),
        // Everything that rules a follow-up out for good is filtered here, so
        // those letters never crowd the due ones out of the batch: the prospect
        // has moved on in the pipeline (opened, talked, „Kein Interesse“, won,
        // lost), has a block marker, a visit since posting or a follow-up already.
        eq(prospects.status, "letter_sent"),
        isNull(prospects.doNotContactAt),
        sql`not exists (
          select 1 from visits v
          where v.workspace_id = ${letters.workspaceId} and v.prospect_id = ${letters.prospectId}
            and v.confirmed_at is not null and not v.is_bot and not v.is_internal
            and v.started_at >= ${letters.postedAt}
        )`,
        sql`not exists (
          select 1 from letters f
          where f.workspace_id = ${letters.workspaceId} and f.prospect_id = ${letters.prospectId}
            and f.kind = 'follow_up' and f.status <> 'cancelled'
        )`,
        // Workspaces that switched the rule off.
        sql`coalesce((
          select (s.letter -> 'followUp' ->> 'enabled')::boolean from workspace_settings s
          where s.workspace_id = ${letters.workspaceId}
        ), true)`,
      ),
    )
    .orderBy(asc(letters.postedAt))
    .limit(200);

  let prepared = 0;
  const settingsCache = new Map<string, Awaited<ReturnType<typeof loadWorkspaceSettings>>>();
  const ownerCache = new Map<string, string | null>();
  for (const letter of candidates) {
    try {
      let settings = settingsCache.get(letter.workspaceId);
      if (!settings) {
        settings = await loadWorkspaceSettings(db, letter.workspaceId);
        settingsCache.set(letter.workspaceId, settings);
      }
      const decision = followUpDecision(
        { postedAt: letter.postedAt!, openedAt: null, doNotContact: false, hasFollowUp: false },
        settings.letter.followUp,
        now,
      );
      if (decision === "skip") {
        // Past the window: settle it, so it no longer counts as a candidate.
        await db
          .update(letters)
          .set({ followUpAt: now })
          .where(and(eq(letters.workspaceId, letter.workspaceId), eq(letters.id, letter.id)));
        continue;
      }
      if (decision !== "due") continue;
      if (!ownerCache.has(letter.workspaceId)) {
        ownerCache.set(letter.workspaceId, await workspaceOwner(db, letter.workspaceId));
      }
      const owner = ownerCache.get(letter.workspaceId);
      if (!owner) continue;
      const zone = settings.notifications.timezone;
      const done = await withTenant(
        db,
        { userId: owner, workspaceId: letter.workspaceId },
        async (tx) => {
          // Claim the first letter, so two overlapping runs never prepare two follow-ups.
          const [claimed] = await tx
            .update(letters)
            .set({ followUpAt: now })
            .where(
              and(
                eq(letters.workspaceId, letter.workspaceId),
                eq(letters.id, letter.id),
                isNull(letters.followUpAt),
              ),
            )
            .returning({ id: letters.id });
          if (!claimed) return false;
          const actor = { userId: owner, role: "owner" as const, workspaceId: letter.workspaceId };
          const { created } = await createLetters(tx, actor, {
            prospectIds: [letter.prospectId],
            kind: "follow_up",
            auto: true,
          });
          // No published exposé any more, or blocked meanwhile: nothing to follow up.
          if (created.length === 0) return false;
          const postedOn = new Intl.DateTimeFormat("de-DE", {
            dateStyle: "medium",
            timeZone: zone,
          }).format(letter.postedAt!);
          const taskId = await createTask(
            tx,
            actor,
            letter.prospectId,
            {
              title: FOLLOW_UP_TASK_TITLE,
              note: followUpTaskNote(postedOn),
              dueDate: localDateString(now, zone),
              dueTime: null,
              reminder: "at_due",
            },
            now,
          );
          // Remind now rather than at 8:00, which may be past already.
          if (taskId) {
            await tx
              .update(tasks)
              .set({ remindAt: now, remindedAt: null })
              .where(and(eq(tasks.workspaceId, letter.workspaceId), eq(tasks.id, taskId)));
          }
          return true;
        },
      );
      if (done) prepared += 1;
    } catch (error) {
      console.error("follow-up failed", letter.id, error);
    }
  }
  return { checked: candidates.length, prepared };
}

async function workspaceOwner(db: Database, workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, "owner")))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  return row?.userId ?? null;
}
