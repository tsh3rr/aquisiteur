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
import { workspaceIsolation } from "../rls";
import { prospects } from "./prospects";
import { workspaces } from "./tenancy";
import { visits } from "./tracking";

export const consentDecision = pgEnum("consent_decision", ["given", "denied", "withdrawn"]);

/**
 * A visitor's answer to the replay notice (§9, § 25 TDDDG). Kept as proof
 * of consent: which wording, when, for which visit. Never pre-ticked.
 */
export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    scope: text("scope").notNull().default("replay"),
    decision: consentDecision("decision").notNull(),
    /** Version of the notice text the visitor saw. */
    noticeVersion: text("notice_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("consents_visit_idx").on(t.workspaceId, t.visitId, t.createdAt),
    foreignKey({
      name: "consents_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "consents_visit_fk",
      columns: [t.workspaceId, t.visitId],
      foreignColumns: [visits.workspaceId, visits.id],
    }).onDelete("cascade"),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/**
 * A recorded session (rrweb) of one visit, after consent. The recording is
 * stored as gzip chunks in storage under
 * `<workspace_id>/replays/<id>/<n>.json.gz`; this row only indexes them.
 */
export const sessionReplays = pgTable(
  "session_replays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    chunkCount: integer("chunk_count").notNull().default(0),
    bytes: integer("bytes").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastChunkAt: timestamp("last_chunk_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("session_replays_visit_idx").on(t.workspaceId, t.visitId),
    index("session_replays_prospect_idx").on(t.workspaceId, t.prospectId, t.startedAt),
    foreignKey({
      name: "session_replays_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "session_replays_visit_fk",
      columns: [t.workspaceId, t.visitId],
      foreignColumns: [visits.workspaceId, visits.id],
    }).onDelete("cascade"),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
