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
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
