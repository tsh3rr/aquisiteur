import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Explanation } from "../../domain/intent/explain";
import type { StoredSignal } from "../../domain/intent/stored";
import { workspaceIsolation } from "../rls";
import { users } from "./auth";
import { prospects } from "./prospects";
import { workspaces } from "./tenancy";

export const intentLevel = pgEnum("intent_level", [
  "curious",
  "interested",
  "likely",
  "very_likely",
  "confirmed",
]);

/**
 * The current contact-intent score per prospect (§7.6), materialised after
 * every signal so lists can sort by it. The signals themselves stay in
 * events, drafts, messages and callbacks; this row is derived and can be
 * recomputed at any time (e.g. after the weights change).
 */
export const intentScores = pgTable(
  "intent_scores",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    score: integer("score").notNull().default(0),
    level: intentLevel("level").notNull().default("curious"),
    signals: jsonb("signals").$type<StoredSignal[]>().notNull().default([]),
    explanation: jsonb("explanation").$type<Explanation>().notNull(),
    lastSignalAt: timestamp("last_signal_at", { withTimezone: true }),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "intent_scores_pkey", columns: [t.workspaceId, t.prospectId] }),
    index("intent_scores_rank_idx").on(t.workspaceId, t.score, t.lastSignalAt),
    foreignKey({
      name: "intent_scores_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

export const notificationTrigger = pgEnum("notification_trigger", [
  "first_visit",
  "return_visit",
  "chat_message",
  "callback",
  "score_threshold",
  "opt_out",
  "daily_digest",
  "task_due",
  "offer_viewed",
  "offer_answered",
]);
export const notificationChannel = pgEnum("notification_channel", ["push", "email"]);

/**
 * Rule engine (§7.7): event → channels → conditions. Defaults are inserted
 * with the workspace; the owner edits them in the settings.
 */
export const notificationRules = pgTable(
  "notification_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    trigger: notificationTrigger("trigger").notNull(),
    /** score_threshold: percent; daily_digest: hour of the day. */
    threshold: integer("threshold"),
    channels: notificationChannel("channels").array().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** "22:00"–"07:00": recorded in the cockpit, but no push or e-mail. */
    quietFrom: text("quiet_from"),
    quietTo: text("quiet_to"),
    weekdaysOnly: boolean("weekdays_only").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_rules_workspace_idx").on(t.workspaceId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/**
 * What the owner was told (§7.7), also the in-app list. Updates from the
 * same visit or chat within the debounce window are grouped into one row
 * (`group_key`), so a visit with 30 events is one notification.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => notificationRules.id, { onDelete: "set null" }),
    prospectId: uuid("prospect_id"),
    trigger: notificationTrigger("trigger").notNull(),
    groupKey: text("group_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Cockpit path, e.g. the prospect's timeline. */
    url: text("url").notNull(),
    /** How many updates were grouped into this notification. */
    count: integer("count").notNull().default(1),
    channels: notificationChannel("channels").array().notNull().default([]),
    /** Why push/e-mail were not sent, e.g. quiet hours. */
    suppressed: text("suppressed"),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_recent_idx").on(t.workspaceId, t.createdAt),
    index("notifications_group_idx").on(t.workspaceId, t.groupKey, t.updatedAt),
    foreignKey({
      name: "notifications_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** Web Push subscriptions of the owner's devices (§7.7, PWA). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** "Chrome auf Android" etc., to tell devices apart in the settings. */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(t.workspaceId, t.endpoint),
    index("push_subscriptions_user_idx").on(t.workspaceId, t.userId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
