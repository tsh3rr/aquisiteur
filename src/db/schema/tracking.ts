import {
  boolean,
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
import { workspaceIsolation } from "../rls";
import { users } from "./auth";
import { exposes } from "./exposes";
import { prospects } from "./prospects";
import { workspaces } from "./tenancy";

/** Where a touchpoint was handed out (§6.2). */
export const touchpointChannel = pgEnum("touchpoint_channel", ["letter", "share", "manual"]);

/**
 * One handed-out way into an exposé (§6.2): a letter, a link the prospect
 * forwarded to a colleague, a link sent by hand. Each has an unguessable QR
 * token and optionally a short code to type in.
 */
export const touchpoints = pgTable(
  "touchpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    exposeId: uuid("expose_id").notNull(),
    channel: touchpointChannel("channel").notNull(),
    label: text("label").notNull(),
    /** ≥ 12 chars base62, case-sensitive; used in QR codes. */
    qrToken: text("qr_token").notNull(),
    /** Lower-case, unambiguous alphabet or a readable slug; typed from the letter. */
    shortCode: text("short_code"),
    /** For `share`: the visit that created it, so forwarded reads are attributed. */
    parentVisitId: uuid("parent_visit_id"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("touchpoints_qr_token_idx").on(t.workspaceId, t.qrToken),
    uniqueIndex("touchpoints_short_code_idx").on(t.workspaceId, t.shortCode),
    index("touchpoints_prospect_idx").on(t.workspaceId, t.prospectId),
    unique("touchpoints_workspace_id_id_key").on(t.workspaceId, t.id),
    foreignKey({
      name: "touchpoints_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "touchpoints_expose_fk",
      columns: [t.workspaceId, t.exposeId],
      foreignColumns: [exposes.workspaceId, exposes.id],
    }).onDelete("cascade"),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** How a visit started: QR scan, typed short code, plain exposé URL, forwarded share link. */
export const visitSource = pgEnum("visit_source", ["qr", "typed", "direct", "share"]);
export const deviceType = pgEnum("device_type", ["mobile", "tablet", "desktop", "unknown"]);

/**
 * One visit of an exposé (§6.2/§6.3). No IP address and no cookie are kept;
 * the city comes from the edge's geo header at request time.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    exposeId: uuid("expose_id").notNull(),
    touchpointId: uuid("touchpoint_id"),
    source: visitSource("source").notNull(),
    device: deviceType("device").notNull().default("unknown"),
    browser: text("browser"),
    os: text("os"),
    city: text("city"),
    country: text("country"),
    /** Link previews, scanners, crawlers: kept for transparency, never notify. */
    isBot: boolean("is_bot").notNull().default(false),
    botReason: text("bot_reason"),
    /** The owner's own device or session. */
    isInternal: boolean("is_internal").notNull().default(false),
    /** Set when the exposé's script reported in: a real browser rendered the page. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** The exposé had expired: the visitor saw the short page (§7.3, ADR-0078). */
    onExpiredPage: boolean("on_expired_page").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Visible time from heartbeats, in seconds. */
    activeSeconds: integer("active_seconds").notNull().default(0),
    /** Deepest scroll position reached, 0–100. */
    maxScroll: integer("max_scroll").notNull().default(0),
    eventCount: integer("event_count").notNull().default(0),
  },
  (t) => [
    index("visits_prospect_idx").on(t.workspaceId, t.prospectId, t.startedAt),
    index("visits_expose_idx").on(t.exposeId, t.startedAt),
    unique("visits_workspace_id_id_key").on(t.workspaceId, t.id),
    foreignKey({
      name: "visits_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "visits_expose_fk",
      columns: [t.workspaceId, t.exposeId],
      foreignColumns: [exposes.workspaceId, exposes.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "visits_touchpoint_fk",
      columns: [t.workspaceId, t.touchpointId],
      foreignColumns: [touchpoints.workspaceId, touchpoints.id],
    }), // Touchpoints are disabled, never deleted while visits reference them.
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** Raw interaction events of a visit (§6.3, §11). Types: src/domain/tracking/events.ts. */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").notNull(),
    exposeId: uuid("expose_id").notNull(),
    type: text("type").notNull(),
    blockId: text("block_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Client time of the event; `createdAt` is when the server stored it. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_expose_time_idx").on(t.exposeId, t.createdAt),
    index("events_visit_idx").on(t.workspaceId, t.visitId, t.occurredAt),
    foreignKey({
      name: "events_visit_fk",
      columns: [t.workspaceId, t.visitId],
      foreignColumns: [visits.workspaceId, visits.id],
    }).onDelete("cascade"),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** Named filters of the customer list (§7.8 "gespeicherte Ansichten"). */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Null: shared with the whole workspace. */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** URL query of the customer list, e.g. "status=opened&activity=7d". */
    query: text("query").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("saved_views_workspace_idx").on(t.workspaceId, t.position),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
