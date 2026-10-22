import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appRole, workspaceIsolation } from "../rls";
import { users } from "./auth";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "member"]);

/** A tenant. Today: the owner's agency. Later: every SaaS customer (§9a). */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Used for the platform fallback host <slug>.<PLATFORM_DOMAIN>. */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    pgPolicy("workspace_members_read", {
      for: "select",
      to: appRole,
      using: sql`${t.id} = app.current_workspace_id() and app.is_member(${t.id})`,
    }),
    pgPolicy("workspace_admins_update", {
      for: "update",
      to: appRole,
      using: sql`${t.id} = app.current_workspace_id() and app.has_role(${t.id}, array['owner','admin'])`,
      withCheck: sql`${t.id} = app.current_workspace_id() and app.has_role(${t.id}, array['owner','admin'])`,
    }),
  ],
).enableRLS();

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("memberships_workspace_user_idx").on(t.workspaceId, t.userId),
    index("memberships_user_id_idx").on(t.userId),
    pgPolicy("memberships_members_read", {
      for: "select",
      to: appRole,
      using: sql`${t.workspaceId} = app.current_workspace_id() and app.is_member(${t.workspaceId})`,
    }),
    pgPolicy("memberships_admins_write", {
      for: "all",
      to: appRole,
      using: sql`${t.workspaceId} = app.current_workspace_id() and app.has_role(${t.workspaceId}, array['owner','admin'])`,
      withCheck: sql`${t.workspaceId} = app.current_workspace_id() and app.has_role(${t.workspaceId}, array['owner','admin'])`,
    }),
  ],
).enableRLS();

/**
 * One row per workspace. Each JSON column is validated by the Zod schema of
 * the same name in src/domain/workspace-settings.ts; nothing here is
 * hard-coded or read from env (§9a).
 */
export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    profile: jsonb("profile").notNull().default({}),
    channels: jsonb("channels").notNull().default({}),
    senderAddress: jsonb("sender_address").notNull().default({}),
    branding: jsonb("branding").notNull().default({}),
    legal: jsonb("legal").notNull().default({}),
    scoreWeights: jsonb("score_weights").notNull().default({}),
    nudges: jsonb("nudges").notNull().default({}),
    chat: jsonb("chat").notNull().default({}),
    retention: jsonb("retention").notNull().default({}),
    notifications: jsonb("notifications").notNull().default({}),
    replay: jsonb("replay").notNull().default({}),
    letter: jsonb("letter").notNull().default({}),
    billing: jsonb("billing").notNull().default({}),
    ...timestamps,
  },
  (t) => [workspaceIsolation(t.workspaceId)],
).enableRLS();

export const domainStatus = pgEnum("domain_status", ["pending", "active", "failed"]);

/**
 * Custom domains per workspace (e.g. go.agentur.de). The platform fallback
 * host is derived from workspaces.slug and has no row. Hostnames are unique
 * across the platform because routing resolves the workspace from the Host
 * header; short-link codes will be unique per domain, not globally.
 */
export const domains = pgTable(
  "domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    status: domainStatus("status").notNull().default("pending"),
    providerRef: text("provider_ref"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("domains_workspace_id_idx").on(t.workspaceId), workspaceIsolation(t.workspaceId)],
).enableRLS();

/** Per-workspace external services. Secrets are AES-GCM encrypted (src/lib/crypto.ts). */
export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    config: jsonb("config").notNull().default({}),
    secretCiphertext: text("secret_ciphertext"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("integrations_workspace_kind_idx").on(t.workspaceId, t.kind),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** Billing-relevant counters from day one (exposés published, visits, letters, storage). */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    quantity: integer("quantity").notNull().default(1),
    meta: jsonb("meta").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_events_workspace_time_idx").on(t.workspaceId, t.occurredAt),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** Workspace API tokens for the exposé CLI / REST API (phase 1). Only hashes are stored. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First characters of the token, shown in the UI to recognise it. */
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_tokens_workspace_id_idx").on(t.workspaceId),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** Append-only audit trail per workspace (§9a "Datenschutz als Plattform"). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_workspace_time_idx").on(t.workspaceId, t.createdAt),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** Platform operator role (§9a). No UI in v1; only the system connection reads it. */
export const platformAdmins = pgTable("platform_admins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
