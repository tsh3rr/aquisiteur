import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
    estimatedValueCents: integer("estimated_value_cents"),
    ...timestamps,
  },
  (t) => [
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
