import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  LETTER_KINDS,
  LETTER_STATUSES,
  type StoredPrintOptions,
} from "../../domain/letters/lifecycle";
import { workspaceIsolation } from "../rls";
import { users } from "./auth";
import { campaigns, prospects } from "./prospects";
import { workspaces } from "./tenancy";
import { touchpoints } from "./tracking";

export const letterStatus = pgEnum("letter_status", LETTER_STATUSES);
export const letterKind = pgEnum("letter_kind", LETTER_KINDS);

/**
 * One printed letter (§7.9). Each letter carries its own touchpoint, so a
 * follow-up has its own code. Subject and body are a snapshot of what was
 * printed; the PDF itself is rendered from them on demand.
 */
export const letters = pgTable(
  "letters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    campaignId: uuid("campaign_id"),
    touchpointId: uuid("touchpoint_id").notNull(),
    kind: letterKind("kind").notNull().default("initial"),
    status: letterStatus("status").notNull().default("draft"),
    provider: text("provider").notNull().default("manual"),
    providerRef: text("provider_ref"),
    options: jsonb("options").$type<StoredPrintOptions>().notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    costCents: integer("cost_cents"),
    failureReason: text("failure_reason"),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    printedAt: timestamp("printed_at", { withTimezone: true }),
    /** „Zeit bis zur Öffnung“ always counts from here. */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** First letters only: when the follow-up rule prepared a follow-up for it (§7.9). */
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("letters_prospect_idx").on(t.workspaceId, t.prospectId, t.createdAt),
    index("letters_campaign_idx").on(t.workspaceId, t.campaignId),
    index("letters_posted_idx").on(t.workspaceId, t.postedAt),
    // The hourly job looks across workspaces for first letters that may need a follow-up.
    index("letters_follow_up_idx")
      .on(t.postedAt)
      .where(sql`${t.kind} = 'initial' and ${t.status} = 'posted' and ${t.followUpAt} is null`),
    foreignKey({
      name: "letters_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "letters_campaign_fk",
      columns: [t.workspaceId, t.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }),
    foreignKey({
      name: "letters_touchpoint_fk",
      columns: [t.workspaceId, t.touchpointId],
      foreignColumns: [touchpoints.workspaceId, touchpoints.id],
    }),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
