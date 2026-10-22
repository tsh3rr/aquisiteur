import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Database, Transaction } from "@/db";
import { auditLog, prospects, tasks } from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { notificationCopy, notificationUrl, TASK_REMINDER_FALLBACK } from "@/domain/notifications";
import { compareTasks, formatDue, reminderAt, type TaskForm } from "@/domain/tasks";
import { dispatch, notify } from "@/server/notifications/notify";
import { publish, workspaceTopic } from "@/server/realtime";
import { loadWorkspaceSettings } from "@/server/workspaces";

/** Tasks and follow-ups (§7.8). Cockpit functions run inside withTenant. */

export interface TaskView {
  id: string;
  prospectId: string;
  invoiceId: string | null;
  companyName: string;
  title: string;
  note: string | null;
  dueDate: string;
  dueTime: string | null;
  reminder: (typeof tasks.$inferSelect)["reminder"];
  remindAt: Date | null;
  doneAt: Date | null;
  doNotContact: boolean;
}

const view = {
  id: tasks.id,
  prospectId: tasks.prospectId,
  invoiceId: tasks.invoiceId,
  companyName: prospects.companyName,
  title: tasks.title,
  note: tasks.note,
  dueDate: tasks.dueDate,
  dueTime: tasks.dueTime,
  reminder: tasks.reminder,
  remindAt: tasks.remindAt,
  doneAt: tasks.doneAt,
  doNotContact: sql<boolean>`${prospects.doNotContactAt} is not null`,
};

function joined(tx: Transaction) {
  return tx
    .select(view)
    .from(tasks)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, tasks.workspaceId), eq(prospects.id, tasks.prospectId)),
    );
}

/**
 * Open tasks, earliest first. `until` (a local date) limits them to what is
 * due by then, e.g. today for „Heute“; that view leaves out prospects with a
 * block marker, since „Kein Interesse“ stops follow-ups (§7.3).
 */
export async function listOpenTasks(
  tx: Transaction,
  workspaceId: string,
  options: { until?: string; prospectId?: string; limit?: number } = {},
): Promise<TaskView[]> {
  const rows = await joined(tx)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        isNull(tasks.doneAt),
        options.until ? lte(tasks.dueDate, options.until) : undefined,
        options.until ? isNull(prospects.doNotContactAt) : undefined,
        options.prospectId ? eq(tasks.prospectId, options.prospectId) : undefined,
      ),
    )
    .orderBy(asc(tasks.dueDate), asc(sql`coalesce(${tasks.dueTime}, '99:99')`))
    .limit(options.limit ?? 500);
  return rows.sort(compareTasks);
}

/** Done tasks, newest first; `sinceDays` limits the list for the overview. */
export async function listDoneTasks(
  tx: Transaction,
  workspaceId: string,
  options: { prospectId?: string; sinceDays?: number; limit?: number } = {},
): Promise<TaskView[]> {
  return joined(tx)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        isNotNull(tasks.doneAt),
        options.prospectId ? eq(tasks.prospectId, options.prospectId) : undefined,
        options.sinceDays
          ? gte(tasks.doneAt, new Date(Date.now() - options.sinceDays * 86_400_000))
          : undefined,
      ),
    )
    .orderBy(desc(tasks.doneAt))
    .limit(options.limit ?? 50);
}

async function timeZone(tx: Transaction, workspaceId: string) {
  return (await loadWorkspaceSettings(tx, workspaceId)).notifications.timezone;
}

/** Reminder instant; one that is already past is marked as sent, so saving never pings. */
function reminderFields(form: TaskForm, zone: string, now: Date) {
  const remindAt = reminderAt(form, zone);
  return { remindAt, remindedAt: remindAt && remindAt <= now ? now : null };
}

async function changed(workspaceId: string, prospectId: string) {
  await publish([workspaceTopic(workspaceId)], "task.changed", { prospectId });
}

export async function createTask(
  tx: Transaction,
  actor: Actor,
  prospectId: string,
  form: TaskForm,
  now = new Date(),
): Promise<string | null> {
  const [prospect] = await tx
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, actor.workspaceId), eq(prospects.id, prospectId)));
  if (!prospect) return null;
  const zone = await timeZone(tx, actor.workspaceId);
  const [row] = await tx
    .insert(tasks)
    .values({
      workspaceId: actor.workspaceId,
      prospectId,
      title: form.title,
      note: form.note,
      dueDate: form.dueDate,
      dueTime: form.dueTime,
      reminder: form.reminder,
      ...reminderFields(form, zone, now),
      createdBy: actor.userId,
    })
    .returning({ id: tasks.id });
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "task.created",
    targetType: "prospect",
    targetId: prospectId,
    meta: { taskId: row!.id },
  });
  await changed(actor.workspaceId, prospectId);
  return row!.id;
}

/** Edits a task; a new due date or reminder re-arms the reminder. */
export async function updateTask(
  tx: Transaction,
  actor: Actor,
  id: string,
  form: TaskForm,
  now = new Date(),
): Promise<boolean> {
  const zone = await timeZone(tx, actor.workspaceId);
  const [row] = await tx
    .update(tasks)
    .set({
      title: form.title,
      note: form.note,
      dueDate: form.dueDate,
      dueTime: form.dueTime,
      reminder: form.reminder,
      ...reminderFields(form, zone, now),
    })
    .where(and(eq(tasks.workspaceId, actor.workspaceId), eq(tasks.id, id)))
    .returning({ prospectId: tasks.prospectId });
  if (!row) return false;
  await changed(actor.workspaceId, row.prospectId);
  return true;
}

/** Moves the due date, keeping clock time and reminder kind. */
export async function snoozeTask(
  tx: Transaction,
  actor: Actor,
  id: string,
  dueDate: string,
  now = new Date(),
): Promise<boolean> {
  const [task] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.workspaceId, actor.workspaceId), eq(tasks.id, id)));
  if (!task) return false;
  return updateTask(
    tx,
    actor,
    id,
    {
      title: task.title,
      note: task.note,
      dueDate,
      dueTime: task.dueTime,
      reminder: task.reminder,
    },
    now,
  );
}

export async function setTaskDone(
  tx: Transaction,
  actor: Actor,
  id: string,
  done: boolean,
): Promise<boolean> {
  const [row] = await tx
    .update(tasks)
    .set({ doneAt: done ? new Date() : null })
    .where(and(eq(tasks.workspaceId, actor.workspaceId), eq(tasks.id, id)))
    .returning({ prospectId: tasks.prospectId, title: tasks.title });
  if (!row) return false;
  if (done) {
    await tx.insert(auditLog).values({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: "task.done",
      targetType: "prospect",
      targetId: row.prospectId,
      meta: { taskId: id },
    });
  }
  await changed(actor.workspaceId, row.prospectId);
  return true;
}

export async function deleteTask(tx: Transaction, actor: Actor, id: string): Promise<boolean> {
  const [row] = await tx
    .delete(tasks)
    .where(and(eq(tasks.workspaceId, actor.workspaceId), eq(tasks.id, id)))
    .returning({ prospectId: tasks.prospectId });
  if (!row) return false;
  await changed(actor.workspaceId, row.prospectId);
  return true;
}

/**
 * Hourly job: sends the reminders that are due, across workspaces (system
 * connection, every query scoped by the task's workspace). A task is claimed
 * before it is sent, so two overlapping runs never remind twice.
 */
export async function runTaskReminders(db: Database, now = new Date()) {
  const due = await db
    .select({
      id: tasks.id,
      workspaceId: tasks.workspaceId,
      prospectId: tasks.prospectId,
      title: tasks.title,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      remindAt: tasks.remindAt,
      company: prospects.companyName,
    })
    .from(tasks)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, tasks.workspaceId), eq(prospects.id, tasks.prospectId)),
    )
    .where(
      and(
        lte(tasks.remindAt, now),
        isNull(tasks.remindedAt),
        isNull(tasks.doneAt),
        // „Kein Interesse“ stops follow-ups (§7.3); the task stays on the customer page.
        isNull(prospects.doNotContactAt),
      ),
    )
    .orderBy(asc(tasks.remindAt))
    .limit(200);

  let sent = 0;
  for (const task of due) {
    try {
      const [claimed] = await db
        .update(tasks)
        .set({ remindedAt: now })
        .where(
          and(
            eq(tasks.workspaceId, task.workspaceId),
            eq(tasks.id, task.id),
            isNull(tasks.remindedAt),
          ),
        )
        .returning({ id: tasks.id });
      if (!claimed) continue;
      const zone = (await loadWorkspaceSettings(db, task.workspaceId)).notifications.timezone;
      const pending = await notify(
        db,
        {
          workspaceId: task.workspaceId,
          trigger: "task_due",
          prospectId: task.prospectId,
          groupKey: `task:${task.id}:${task.remindAt!.toISOString()}`,
          ...notificationCopy({
            trigger: "task_due",
            company: task.company,
            task: task.title,
            due: formatDue(task, now, zone),
          }),
          url: notificationUrl({
            trigger: "task_due",
            prospectId: task.prospectId,
            taskId: task.id,
          }),
          fallbackChannels: TASK_REMINDER_FALLBACK,
        },
        now,
      );
      if (pending) {
        await dispatch(db, pending);
        sent += 1;
      }
    } catch (error) {
      console.error("task reminder failed", task.id, error);
    }
  }
  return { due: due.length, sent };
}

/** Serialisable shape for the cockpit's task components. */
export function taskItemView(task: TaskView) {
  return {
    id: task.id,
    prospectId: task.prospectId,
    invoiceId: task.invoiceId,
    companyName: task.companyName,
    title: task.title,
    note: task.note,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    reminder: task.reminder,
    remindAt: task.remindAt?.toISOString() ?? null,
    done: task.doneAt !== null,
    doNotContact: task.doNotContact,
  };
}

/** „now“ and the time zone for task components, so server and client render alike. */
export async function taskClock(tx: Transaction, workspaceId: string, now = new Date()) {
  return { now: now.toISOString(), timeZone: await timeZone(tx, workspaceId) };
}
