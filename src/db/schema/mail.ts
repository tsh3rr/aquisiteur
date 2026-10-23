import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { EMAIL_STATUSES } from "../../domain/email";
import { workspaceIsolation } from "../rls";
import { users } from "./auth";
import { invoiceReminders, invoices, maintenanceContracts, projects } from "./projects";
import { prospects } from "./prospects";
import { workspaces } from "./tenancy";

export const emailStatus = pgEnum("email_status", EMAIL_STATUSES);
export const outboundEmailKind = pgEnum("outbound_email_kind", [
  "invoice",
  "reminder",
  "contract_notice",
]);

/**
 * Every mail sent to a customer (§7.10, phase 7c-2), with the Message-ID it
 * went out with, so a later inbox can thread replies to the customer, project
 * and invoice. The body is not stored: the invoice is the record. Status from
 * the provider's webhooks; no open tracking.
 */
export const outboundEmails = pgTable(
  "outbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: outboundEmailKind("kind").notNull(),
    prospectId: uuid("prospect_id").notNull(),
    projectId: uuid("project_id"),
    invoiceId: uuid("invoice_id"),
    /** For kind "reminder": the reminder or dunning letter (7c-4). */
    reminderId: uuid("reminder_id"),
    /** For kind "contract_notice": the contract whose price change it announces (7c-3b). */
    contractId: uuid("contract_id"),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    /** Our Message-ID header, `<id@sending-domain>`. */
    messageId: text("message_id").notNull(),
    /** The provider's id, the key of its webhooks; null until accepted (or with the log provider). */
    providerId: text("provider_id"),
    status: emailStatus("status").notNull().default("sending"),
    statusAt: timestamp("status_at", { withTimezone: true }).notNull().defaultNow(),
    /** Why it failed or bounced, from the provider. */
    error: text("error"),
    attachmentBytes: integer("attachment_bytes"),
    sentBy: text("sent_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "outbound_emails_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "outbound_emails_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "outbound_emails_invoice_fk",
      columns: [t.workspaceId, t.invoiceId],
      foreignColumns: [invoices.workspaceId, invoices.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "outbound_emails_reminder_fk",
      columns: [t.workspaceId, t.reminderId],
      foreignColumns: [invoiceReminders.workspaceId, invoiceReminders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "outbound_emails_contract_fk",
      columns: [t.workspaceId, t.contractId],
      foreignColumns: [maintenanceContracts.workspaceId, maintenanceContracts.id],
    }).onDelete("cascade"),
    index("outbound_emails_prospect_idx").on(t.workspaceId, t.prospectId),
    index("outbound_emails_invoice_idx").on(t.workspaceId, t.invoiceId),
    index("outbound_emails_reminder_idx").on(t.workspaceId, t.reminderId),
    index("outbound_emails_contract_idx").on(t.workspaceId, t.contractId),
    // Webhooks look a mail up by the provider's id across workspaces.
    uniqueIndex("outbound_emails_provider_idx").on(t.providerId),
    uniqueIndex("outbound_emails_message_idx").on(t.messageId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/**
 * The customer's copy of an issued invoice (§7.10): the token of the page
 * `/r/<token>` and the PDF stored the first time it was sent, so the customer
 * always downloads the file that was mailed. Kept apart from `invoices`, whose
 * rows are frozen at issue.
 */
export const invoiceShares = pgTable(
  "invoice_shares",
  {
    invoiceId: uuid("invoice_id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Public path segment, unguessable (§10). */
    token: text("token").notNull(),
    pdfKey: text("pdf_key"),
    pdfBytes: integer("pdf_bytes"),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "invoice_shares_invoice_fk",
      columns: [t.workspaceId, t.invoiceId],
      foreignColumns: [invoices.workspaceId, invoices.id],
    }).onDelete("cascade"),
    uniqueIndex("invoice_shares_token_idx").on(t.token),
    index("invoice_shares_workspace_idx").on(t.workspaceId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
