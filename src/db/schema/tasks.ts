import { sql } from "drizzle-orm";
import {
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaceIsolation } from "../rls";
import { users } from "./auth";
import { prospects } from "./prospects";
import { workspaces } from "./tenancy";

export const taskReminder = pgEnum("task_reminder", [
  "none",
  "at_due",
  "hour_before",
  "day_before",
]);

/**
 * A follow-up on a prospect (§7.8 „Aufgaben/Wiedervorlagen“), e.g. „Freitag
 * anrufen“. Due on a local calendar date, optionally at a clock time; the
 * reminder instant is computed in the workspace's time zone when the task is
 * saved and sent by the hourly job.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    title: text("title").notNull(),
    note: text("note"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    /** "14:00"; null: all day. */
    dueTime: text("due_time"),
    reminder: taskReminder("reminder").notNull().default("at_due"),
    remindAt: timestamp("remind_at", { withTimezone: true }),
    /** Set once the reminder went out (or was due already when the task was saved). */
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      name: "tasks_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    index("tasks_open_idx")
      .on(t.workspaceId, t.dueDate, t.dueTime)
      .where(sql`${t.doneAt} is null`),
    index("tasks_prospect_idx").on(t.workspaceId, t.prospectId),
    // The hourly job looks across workspaces for reminders that are due.
    index("tasks_reminder_idx")
      .on(t.remindAt)
      .where(sql`${t.remindedAt} is null and ${t.doneAt} is null`),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
