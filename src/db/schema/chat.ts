import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaceIsolation } from "../rls";
import { users } from "./auth";
import { exposes } from "./exposes";
import { prospects } from "./prospects";
import { workspaces } from "./tenancy";
import { visits } from "./tracking";

export const chatThreadStatus = pgEnum("chat_thread_status", ["open", "closed"]);
export const returnChannel = pgEnum("return_channel", ["email", "phone", "whatsapp"]);

/**
 * One live chat from an exposé (§7.5). The visitor stays anonymous until
 * they leave a return channel; the thread hangs off the prospect, because
 * the exposé is personalised.
 */
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    exposeId: uuid("expose_id").notNull(),
    /** The visit the first message came from. */
    visitId: uuid("visit_id"),
    status: chatThreadStatus("status").notNull().default("open"),
    visitorName: text("visitor_name"),
    visitorEmail: text("visitor_email"),
    visitorPhone: text("visitor_phone"),
    returnChannel: returnChannel("return_channel"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastVisitorMessageAt: timestamp("last_visitor_message_at", { withTimezone: true }),
    lastOwnerMessageAt: timestamp("last_owner_message_at", { withTimezone: true }),
    /** Unread for the owner: visitor messages after this point. */
    ownerReadAt: timestamp("owner_read_at", { withTimezone: true }),
    /** The automatic „I'll get back to you“ message of the current unanswered stretch. */
    offlineNoticeAt: timestamp("offline_notice_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_threads_recent_idx").on(t.workspaceId, t.lastMessageAt),
    index("chat_threads_prospect_idx").on(t.workspaceId, t.prospectId),
    unique("chat_threads_workspace_id_id_key").on(t.workspaceId, t.id),
    foreignKey({
      name: "chat_threads_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "chat_threads_expose_fk",
      columns: [t.workspaceId, t.exposeId],
      foreignColumns: [exposes.workspaceId, exposes.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "chat_threads_visit_fk",
      columns: [t.workspaceId, t.visitId],
      foreignColumns: [visits.workspaceId, visits.id],
    }),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

export const chatAuthor = pgEnum("chat_author", ["visitor", "owner", "system"]);
/** `handover`: the owner suggests WhatsApp; `offline`: the automatic notice. */
export const chatMessageKind = pgEnum("chat_message_kind", ["text", "handover", "offline"]);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull(),
    author: chatAuthor("author").notNull(),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    kind: chatMessageKind("kind").notNull().default("text"),
    body: text("body").notNull(),
    /** Visitor messages: the visit they were sent from. */
    visitId: uuid("visit_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_messages_thread_idx").on(t.workspaceId, t.threadId, t.createdAt),
    foreignKey({
      name: "chat_messages_thread_fk",
      columns: [t.workspaceId, t.threadId],
      foreignColumns: [chatThreads.workspaceId, chatThreads.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "chat_messages_visit_fk",
      columns: [t.workspaceId, t.visitId],
      foreignColumns: [visits.workspaceId, visits.id],
    }),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/**
 * Typed but unsent text in the chat (§7.5 „Entwurfserkennung“). By default
 * only the length; the content only when the workspace enabled it and the
 * widget says so.
 */
export const chatDrafts = pgTable(
  "chat_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    threadId: uuid("thread_id"),
    /** Current length of the text field; 0 after sending. */
    length: integer("length").notNull().default(0),
    /** Longest the draft ever got in this visit. */
    maxLength: integer("max_length").notNull().default(0),
    content: text("content"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_drafts_visit_idx").on(t.workspaceId, t.visitId),
    index("chat_drafts_prospect_idx").on(t.workspaceId, t.prospectId),
    foreignKey({
      name: "chat_drafts_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "chat_drafts_visit_fk",
      columns: [t.workspaceId, t.visitId],
      foreignColumns: [visits.workspaceId, visits.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "chat_drafts_thread_fk",
      columns: [t.workspaceId, t.threadId],
      foreignColumns: [chatThreads.workspaceId, chatThreads.id],
    }).onDelete("cascade"),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

export const callbackStatus = pgEnum("callback_status", ["open", "done"]);

/** „Rückruf anfordern“ from the contact block (§7.4). */
export const callbackRequests = pgTable(
  "callback_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    exposeId: uuid("expose_id").notNull(),
    visitId: uuid("visit_id"),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    preferredTime: text("preferred_time"),
    note: text("note"),
    status: callbackStatus("status").notNull().default("open"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneByUserId: text("done_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("callback_requests_status_idx").on(t.workspaceId, t.status, t.createdAt),
    index("callback_requests_prospect_idx").on(t.workspaceId, t.prospectId),
    foreignKey({
      name: "callback_requests_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "callback_requests_expose_fk",
      columns: [t.workspaceId, t.exposeId],
      foreignColumns: [exposes.workspaceId, exposes.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "callback_requests_visit_fk",
      columns: [t.workspaceId, t.visitId],
      foreignColumns: [visits.workspaceId, visits.id],
    }),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

export const availability = pgEnum("availability", ["auto", "available", "away"]);

/**
 * „Verfügbar“ in the exposé (§7.4): a member counts as online while a
 * cockpit tab reports in (`auto`) or when they set the status by hand.
 */
export const memberPresence = pgTable(
  "member_presence",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    availability: availability("availability").notNull().default("auto"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "member_presence_pkey", columns: [t.workspaceId, t.userId] }),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
