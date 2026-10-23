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
import { invoiceReminders, invoices, maintenanceContracts } from "./projects";
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
    /** Set for „Rechnung freigeben“ (§7.10, 7c-2); the task closes itself once the invoice is sent. */
    invoiceId: uuid("invoice_id"),
    /** Set for „Zahlungserinnerung/Mahnung freigeben“ (7c-4); closes once that reminder is sent. */
    reminderId: uuid("reminder_id"),
    /** Set for „Wertsicherung prüfen“ (7c-3b); closes once that cycle's adjustment is decided. */
    contractId: uuid("contract_id"),
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
    foreignKey({
      name: "tasks_invoice_fk",
      columns: [t.workspaceId, t.invoiceId],
      foreignColumns: [invoices.workspaceId, invoices.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "tasks_reminder_fk",
      columns: [t.workspaceId, t.reminderId],
      foreignColumns: [invoiceReminders.workspaceId, invoiceReminders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "tasks_contract_fk",
      columns: [t.workspaceId, t.contractId],
      foreignColumns: [maintenanceContracts.workspaceId, maintenanceContracts.id],
    }).onDelete("cascade"),
    index("tasks_prospect_idx").on(t.workspaceId, t.prospectId),
    index("tasks_invoice_idx").on(t.workspaceId, t.invoiceId),
    index("tasks_invoice_reminder_idx").on(t.workspaceId, t.reminderId),
    index("tasks_contract_idx").on(t.workspaceId, t.contractId),
    // The hourly job looks across workspaces for reminders that are due.
    index("tasks_reminder_idx")
      .on(t.remindAt)
      .where(sql`${t.remindedAt} is null and ${t.doneAt} is null`),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
