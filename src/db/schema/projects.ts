import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DunningLevel, ReminderStatus } from "../../domain/invoices/dunning";
import type { InvoiceSendMode } from "../../domain/invoices/email";
import type { ContractTiming } from "../../domain/invoices/maintenance";
import type {
  InvoiceDocument,
  InvoiceIssuer,
  InvoiceLine,
  InvoiceParty,
} from "../../domain/invoices/schema";
import type { InvoiceTotals } from "../../domain/invoices/totals";
import type { OfferAcceptance } from "../../domain/offers/acceptance";
import type { OfferDocument } from "../../domain/offers/schema";
import { workspaceIsolation } from "../rls";
import { users } from "./auth";
import { prospects } from "./prospects";
import { workspaces } from "./tenancy";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const projectStatus = pgEnum("project_status", [
  "idea",
  "offered",
  "ordered",
  "in_progress",
  "done",
  "cancelled",
]);

/**
 * A piece of work for one customer (§7.10), e.g. „Website-Relaunch 2026“.
 * Bundles exposés, offers and, from phase 7b, invoices. A customer is the
 * prospect itself, so projects hang directly off `prospects`.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatus("status").notNull().default("idea"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "projects_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    unique("projects_workspace_id_id_key").on(t.workspaceId, t.id),
    index("projects_prospect_idx").on(t.workspaceId, t.prospectId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

export const billingInterval = pgEnum("billing_interval", [
  "once",
  "monthly",
  "quarterly",
  "halfyearly",
  "yearly",
]);

/** Service catalogue (§7.10 „Leistungskatalog“): templates for offer lines. */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    unit: text("unit").notNull().default("Pauschal"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    billing: billingInterval("billing").notNull().default("once"),
    vatRate: integer("vat_rate").notNull().default(20),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("catalog_items_workspace_idx").on(t.workspaceId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

export const offerStatus = pgEnum("offer_status", [
  "draft",
  "sent",
  "accepted",
  "declined",
  "withdrawn",
]);

/**
 * An offer for a project (§7.10). The owner edits `draft`; sending freezes
 * it as an `offer_versions` row. The public page `/a/<token>` always shows
 * the current version; answering it records the acceptance on this row.
 */
export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** Denormalised from the project for the customer page, timeline and guards. */
    prospectId: uuid("prospect_id").notNull(),
    /** „AN-2026-0001“, assigned on the first send. */
    number: text("number"),
    title: text("title").notNull(),
    status: offerStatus("status").notNull().default("draft"),
    draft: jsonb("draft").$type<OfferDocument>().notNull(),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => offerVersions.id, {
      onDelete: "set null",
    }),
    /** Public path segment, unguessable (§10). */
    publicToken: text("public_token").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Real views of the public page: no bots, not the owner's devices. */
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    acceptance: jsonb("acceptance").$type<OfferAcceptance>(),
    declineReason: text("decline_reason"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "offers_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "offers_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    unique("offers_workspace_id_id_key").on(t.workspaceId, t.id),
    uniqueIndex("offers_public_token_idx").on(t.publicToken),
    uniqueIndex("offers_workspace_number_idx").on(t.workspaceId, t.number),
    index("offers_project_idx").on(t.workspaceId, t.projectId),
    index("offers_prospect_idx").on(t.workspaceId, t.prospectId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** Immutable snapshot of a sent offer, with a checksum the acceptance refers to. */
export const offerVersions = pgTable(
  "offer_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id").notNull(),
    version: integer("version").notNull(),
    document: jsonb("document").$type<OfferDocument>().notNull(),
    /** Tax mode and note at the time of sending, so later setting changes do not alter it. */
    taxMode: text("tax_mode").notNull(),
    taxNote: text("tax_note").notNull(),
    /** sha256 (hex) of the canonical JSON of document, tax mode and validity. */
    sha256: text("sha256").notNull(),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    sentBy: text("sent_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "offer_versions_offer_fk",
      columns: [t.workspaceId, t.offerId],
      foreignColumns: [offers.workspaceId, offers.id],
    }).onDelete("cascade"),
    uniqueIndex("offer_versions_offer_version_idx").on(t.offerId, t.version),
    index("offer_versions_workspace_idx").on(t.workspaceId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/**
 * Number series per workspace, kind and year (§7.10): offers now, invoices
 * and credit notes from phase 7b. A row is bumped with one UPDATE … RETURNING,
 * so two sends never get the same number.
 */
export const numberSeries = pgTable(
  "number_series",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    year: integer("year").notNull(),
    last: integer("last").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.kind, t.year] }),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/**
 * Maintenance contracts (§7.10, phase 7c-3, ADR-0073): the recurring lines of
 * an accepted offer with their interval. The hourly job bills each calendar
 * period (prorated at start and end) and moves `billed_until` forward, so a
 * draft the owner deletes is not created again.
 */
export const maintenanceContracts = pgTable(
  "maintenance_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    projectId: uuid("project_id"),
    offerId: uuid("offer_id"),
    title: text("title").notNull(),
    interval: billingInterval("interval").notNull(),
    timing: text("timing").$type<ContractTiming>().notNull().default("advance"),
    /** Price per full period, as invoice lines. */
    lines: jsonb("lines").$type<InvoiceLine[]>().notNull(),
    /** Null while the start is open (offer said „ab Go-live“). */
    startDate: date("start_date", { mode: "string" }),
    minimumMonths: integer("minimum_months").notNull().default(0),
    noticeMonths: integer("notice_months").notNull().default(0),
    noticeReceivedOn: date("notice_received_on", { mode: "string" }),
    /** Last day of service once the contract is given notice. */
    endDate: date("end_date", { mode: "string" }),
    /** Null: the workspace's setting. */
    sendMode: text("send_mode").$type<InvoiceSendMode>(),
    billedUntil: date("billed_until", { mode: "string" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "maintenance_contracts_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "maintenance_contracts_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }),
    foreignKey({
      name: "maintenance_contracts_offer_fk",
      columns: [t.workspaceId, t.offerId],
      foreignColumns: [offers.workspaceId, offers.id],
    }),
    unique("maintenance_contracts_workspace_id_id_key").on(t.workspaceId, t.id),
    uniqueIndex("maintenance_contracts_offer_interval_idx").on(t.offerId, t.interval),
    index("maintenance_contracts_prospect_idx").on(t.workspaceId, t.prospectId),
    index("maintenance_contracts_project_idx").on(t.workspaceId, t.projectId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

export const invoiceKind = pgEnum("invoice_kind", ["standard", "deposit", "final", "cancellation"]);
export const invoiceStatus = pgEnum("invoice_status", ["draft", "issued", "cancelled"]);

/**
 * Invoices (§7.10, phase 7b, ADR-0070). Drafts are edited freely and have no
 * number. Issuing assigns `RE-YYYY-NNNN` and freezes document, totals, issuer
 * and recipient with a checksum; from then on a trigger refuses changes
 * except the move to „cancelled“, and refuses deleting (retention § 132 BAO).
 * Customer and project cannot be deleted while invoices point at them.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    projectId: uuid("project_id"),
    offerId: uuid("offer_id"),
    /** The instalment of the offer's payment plan this invoice bills. */
    milestoneId: text("milestone_id"),
    kind: invoiceKind("kind").notNull().default("standard"),
    status: invoiceStatus("status").notNull().default("draft"),
    number: text("number"),
    issueDate: date("issue_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    document: jsonb("document").$type<InvoiceDocument>().notNull(),
    /** Frozen at issue. */
    totals: jsonb("totals").$type<InvoiceTotals>(),
    issuer: jsonb("issuer").$type<InvoiceIssuer>(),
    recipient: jsonb("recipient").$type<InvoiceParty>(),
    /** The tax note printed on the invoice, frozen at issue. */
    taxNote: text("tax_note"),
    /** sha256 (hex) of the canonical JSON of number, dates, document, totals and parties. */
    sha256: text("sha256"),
    /** For a cancellation: the invoice it cancels. */
    cancelsInvoiceId: uuid("cancels_invoice_id").references((): AnyPgColumn => invoices.id),
    /** The maintenance contract and the first day of the period this invoice bills (7c-3). */
    contractId: uuid("contract_id"),
    contractPeriodFrom: date("contract_period_from", { mode: "string" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    issuedBy: text("issued_by").references(() => users.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "invoices_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }),
    foreignKey({
      name: "invoices_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }),
    foreignKey({
      name: "invoices_offer_fk",
      columns: [t.workspaceId, t.offerId],
      foreignColumns: [offers.workspaceId, offers.id],
    }),
    foreignKey({
      name: "invoices_contract_fk",
      columns: [t.workspaceId, t.contractId],
      foreignColumns: [maintenanceContracts.workspaceId, maintenanceContracts.id],
    }),
    unique("invoices_workspace_id_id_key").on(t.workspaceId, t.id),
    uniqueIndex("invoices_workspace_number_idx").on(t.workspaceId, t.number),
    // One invoice per contract period; a cancellation repeats the period of the invoice it cancels.
    uniqueIndex("invoices_contract_period_idx")
      .on(t.contractId, t.contractPeriodFrom)
      .where(sql`${t.kind} <> 'cancellation'`),
    index("invoices_prospect_idx").on(t.workspaceId, t.prospectId),
    index("invoices_project_idx").on(t.workspaceId, t.projectId),
    index("invoices_offer_idx").on(t.workspaceId, t.offerId),
    index("invoices_issue_date_idx").on(t.workspaceId, t.issueDate),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** Payments recorded by hand against an issued invoice, partial payments included. */
export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "invoice_payments_invoice_fk",
      columns: [t.workspaceId, t.invoiceId],
      foreignColumns: [invoices.workspaceId, invoices.id],
    }).onDelete("cascade"),
    index("invoice_payments_invoice_idx").on(t.workspaceId, t.invoiceId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/**
 * Payment reminders and dunning letters of an issued invoice (§7.10, phase
 * 7c-4, ADR-0074): one row per level. The hourly job drafts it; claim and
 * deadline are recomputed and frozen when it is sent.
 */
export const invoiceReminders = pgTable(
  "invoice_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    level: smallint("level").$type<DunningLevel>().notNull(),
    status: text("status").$type<ReminderStatus>().notNull().default("draft"),
    /** The day the claim is computed for: drafting, then sending. */
    asOf: date("as_of", { mode: "string" }).notNull(),
    deadline: date("deadline", { mode: "string" }).notNull(),
    openCents: integer("open_cents").notNull(),
    interestCents: integer("interest_cents").notNull().default(0),
    /** Basis points per year; null without interest. */
    interestRateBp: integer("interest_rate_bp"),
    feeCents: integer("fee_cents").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentBy: text("sent_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "invoice_reminders_invoice_fk",
      columns: [t.workspaceId, t.invoiceId],
      foreignColumns: [invoices.workspaceId, invoices.id],
    }).onDelete("cascade"),
    unique("invoice_reminders_workspace_id_id_key").on(t.workspaceId, t.id),
    uniqueIndex("invoice_reminders_invoice_level_idx").on(t.invoiceId, t.level),
    index("invoice_reminders_workspace_idx").on(t.workspaceId, t.invoiceId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
