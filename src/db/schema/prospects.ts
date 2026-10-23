import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { BillingProfile } from "../../domain/invoices/schema";
import { workspaceIsolation } from "../rls";
import { workspaces } from "./tenancy";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Status pipeline (§7.1). */
export const prospectStatus = pgEnum("prospect_status", [
  "draft",
  "letter_sent",
  "opened",
  "interested",
  "contacted",
  "meeting",
  "won",
  "lost",
  "no_interest",
]);

/**
 * A group of prospects for evaluation (§3), e.g. „Cafés Leipzig Okt 26“.
 * Letters and dashboards filter by it.
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("campaigns_workspace_name_idx").on(t.workspaceId, t.name),
    unique("campaigns_workspace_id_id_key").on(t.workspaceId, t.id),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/**
 * A potential customer (§3). Phase 1 creates prospects from exposé files;
 * phase 2 adds the full customer management on top of the same table.
 */
export const prospects = pgTable(
  "prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Stable key from the exposé file (prospect.key), unique per workspace. */
    key: text("key").notNull(),
    companyName: text("company_name").notNull(),
    industry: text("industry"),
    website: text("website"),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),
    country: text("country").notNull().default("DE"),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: prospectStatus("status").notNull().default("draft"),
    /** Set by "Kein Interesse" (§7.3): blocks follow-ups for good. */
    doNotContactAt: timestamp("do_not_contact_at", { withTimezone: true }),
    /**
     * Set when retention removed this prospect's tracking data after an
     * opt-out (§9); only the block marker (`doNotContactAt`) stays.
     */
    trackingPurgedAt: timestamp("tracking_purged_at", { withTimezone: true }),
    /**
     * Set when the owner blocks this prospect's exposé chat and callback form
     * against abuse (ADR-0066); visitor messages are refused while it is set.
     */
    chatBlockedAt: timestamp("chat_blocked_at", { withTimezone: true }),
    /**
     * Sperrvermerk (§7.10, 7c): a deletion request for a customer with issued
     * invoices. Everything but the invoices, projects and offers is deleted;
     * the rest goes once the retention period of § 132 BAO has passed.
     */
    restrictedAt: timestamp("restricted_at", { withTimezone: true }),
    estimatedValueCents: integer("estimated_value_cents"),
    /** Billing profile once the prospect becomes a customer (§7.10, phase 7b). */
    billing: jsonb("billing").$type<BillingProfile>(),
    /** Null: no campaign. Cleared by hand before a campaign is deleted. */
    campaignId: uuid("campaign_id"),
    /** For the map (§7.8), from the address; null until geocoded. */
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    geocodedAt: timestamp("geocoded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "prospects_campaign_fk",
      columns: [t.workspaceId, t.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }),
    index("prospects_campaign_idx").on(t.workspaceId, t.campaignId),
    uniqueIndex("prospects_workspace_key_idx").on(t.workspaceId, t.key),
    // Target of composite foreign keys that pin children to the same workspace.
    unique("prospects_workspace_id_id_key").on(t.workspaceId, t.id),
    index("prospects_workspace_status_idx").on(t.workspaceId, t.status),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** People at a prospect (§11 `contacts`). */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    salutation: text("salutation"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    role: text("role"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "contacts_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    index("contacts_prospect_idx").on(t.workspaceId, t.prospectId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
