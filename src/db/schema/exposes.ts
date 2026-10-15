import {
  type AnyPgColumn,
  bigint,
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
import { prospects } from "./prospects";
import { apiTokens, workspaces } from "./tenancy";

/** One responsive rendition of an image, or the stored file itself for video/captions. */
export interface AssetVariant {
  key: string;
  format: "avif" | "webp" | "mp4" | "webm" | "vtt";
  width: number | null;
  height: number | null;
  bytes: number;
}

/** What a version needs to render one referenced path, denormalised from `assets`. */
export interface ManifestEntry {
  assetId: string;
  kind: "image" | "video" | "captions";
  width: number | null;
  height: number | null;
  variants: AssetVariant[];
}
export type AssetManifest = Record<string, ManifestEntry>;

export const assetKind = pgEnum("asset_kind", ["image", "video", "captions"]);

/**
 * Uploaded files, content-addressed per workspace: the same file published
 * twice is stored once. Images arrive already optimised by the CLI (§5:
 * sharp at publish time, not at runtime). Storage keys start with the
 * workspace id (§9a).
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** sha256 (hex) of the original file as authored. */
    sha256: text("sha256").notNull(),
    kind: assetKind("kind").notNull(),
    originalName: text("original_name").notNull(),
    width: integer("width"),
    height: integer("height"),
    /** Sum of all stored variants, for storage usage (§9a). */
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    variants: jsonb("variants").$type<AssetVariant[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assets_workspace_sha_idx").on(t.workspaceId, t.sha256),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

/** An exposé for one prospect (§3). Content lives in immutable versions. */
export const exposes = pgTable(
  "exposes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").notNull(),
    /** Public path segment: /x/<slug>. Readable prefix plus a random, unguessable part (§10). */
    slug: text("slug").notNull(),
    /** Short reference for prefilled messages ("Ref K7M2", §7.4). */
    refCode: text("ref_code").notNull(),
    title: text("title").notNull(),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => exposeVersions.id, {
      onDelete: "set null",
    }),
    /** Taken offline by the owner; the public URL then answers 404. */
    unpublishedAt: timestamp("unpublished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("exposes_workspace_slug_idx").on(t.workspaceId, t.slug),
    uniqueIndex("exposes_workspace_ref_idx").on(t.workspaceId, t.refCode),
    uniqueIndex("exposes_workspace_prospect_idx").on(t.workspaceId, t.prospectId),
    unique("exposes_workspace_id_id_key").on(t.workspaceId, t.id),
    foreignKey({
      name: "exposes_prospect_fk",
      columns: [t.workspaceId, t.prospectId],
      foreignColumns: [prospects.workspaceId, prospects.id],
    }).onDelete("cascade"),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();

export const publishSource = pgEnum("publish_source", ["api", "cockpit", "seed"]);

/**
 * Immutable snapshot of an exposé (§7.2 "Versionierung"). Events (phase 2)
 * reference the version they were recorded on.
 */
export const exposeVersions = pgTable(
  "expose_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    exposeId: uuid("expose_id").notNull(),
    version: integer("version").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    /** The validated exposé document, exactly as rendered. */
    document: jsonb("document").notNull(),
    assetManifest: jsonb("asset_manifest").$type<AssetManifest>().notNull(),
    source: publishSource("source").notNull(),
    publishedByUserId: text("published_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    apiTokenId: uuid("api_token_id").references(() => apiTokens.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("expose_versions_expose_version_idx").on(t.exposeId, t.version),
    index("expose_versions_workspace_idx").on(t.workspaceId),
    foreignKey({
      name: "expose_versions_expose_fk",
      columns: [t.workspaceId, t.exposeId],
      foreignColumns: [exposes.workspaceId, exposes.id],
    }).onDelete("cascade"),
    workspaceIsolation(t.workspaceId),
  ],
).enableRLS();
