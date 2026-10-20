"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { fieldErrors } from "@/domain/prospects/schema";
import { snoozeDates, taskFormSchema } from "@/domain/tasks";
import { requireCockpit } from "@/server/session";
import { createTask, deleteTask, setTaskDone, snoozeTask, updateTask } from "@/server/tasks";
import { loadWorkspaceSettings } from "@/server/workspaces";

/** Cockpit side of tasks and follow-ups (§7.8). */

export interface TaskFormState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** Changes after every successful save, so the form can reset itself. */
  savedAt?: number;
}

async function manager() {
  const context = await requireCockpit();
  assertCan(context.actor, "prospects.manage", { workspaceId: context.workspace.id });
  return context;
}

function revalidateTasks(prospectId?: string) {
  revalidatePath("/");
  revalidatePath("/aufgaben");
  if (prospectId) revalidatePath(`/kunden/${prospectId}`);
}

const id = z.uuid();

/** Adds a task (prospectId in the form) or edits one (id in the form). */
export async function saveTaskAction(_: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const { actor, tenant } = await manager();
  const parsed = taskFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const taskId = id.safeParse(formData.get("id"));
  const prospectId = id.safeParse(formData.get("prospectId"));
  if (taskId.success) {
    const found = await tenant((tx) => updateTask(tx, actor, taskId.data, parsed.data));
    if (!found) return { ok: false, message: "Aufgabe nicht gefunden." };
  } else if (prospectId.success) {
    const created = await tenant((tx) => createTask(tx, actor, prospectId.data, parsed.data));
    if (!created) return { ok: false, message: "Kunde nicht gefunden." };
  } else {
    return { ok: false, message: "Aufgabe nicht gefunden." };
  }
  revalidateTasks(prospectId.success ? prospectId.data : undefined);
  return {
    ok: true,
    message: taskId.success ? "Aufgabe gespeichert." : "Aufgabe angelegt.",
    savedAt: Date.now(),
  };
}

export async function setTaskDoneAction(taskId: string, done: boolean, prospectId?: string) {
  const { actor, tenant } = await manager();
  const ok = await tenant((tx) => setTaskDone(tx, actor, id.parse(taskId), done));
  revalidateTasks(prospectId);
  return ok;
}

export async function snoozeTaskAction(
  taskId: string,
  until: "tomorrow" | "nextWeek",
  prospectId?: string,
) {
  const { actor, tenant, workspace } = await manager();
  const ok = await tenant(async (tx) => {
    const zone = (await loadWorkspaceSettings(tx, workspace.id)).notifications.timezone;
    const dates = snoozeDates(new Date(), zone);
    return snoozeTask(
      tx,
      actor,
      id.parse(taskId),
      dates[until === "nextWeek" ? "nextWeek" : "tomorrow"],
    );
  });
  revalidateTasks(prospectId);
  return ok;
}

export async function deleteTaskAction(taskId: string, prospectId?: string) {
  const { actor, tenant } = await manager();
  const ok = await tenant((tx) => deleteTask(tx, actor, id.parse(taskId)));
  revalidateTasks(prospectId);
  return ok;
}
