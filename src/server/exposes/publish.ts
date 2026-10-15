import { and, eq, inArray, max, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import {
  assets,
  auditLog,
  contacts,
  exposes,
  exposeVersions,
  prospects,
  usageEvents,
  type AssetManifest,
  type AssetVariant,
} from "@/db/schema";
import { exposeSlug, refCode } from "@/domain/codes";
import { entitlements, withinLimit } from "@/domain/entitlements";
import {
  allowedFormats,
  assetKindForPath,
  CONTENT_TYPES,
  isSha256,
  MAX_BYTES,
  sniffFormat,
  variantKey,
  type AssetKind,
  type VariantFormat,
} from "@/domain/expose/asset-files";
import {
  collectAssetPaths,
  EXPOSE_SCHEMA_VERSION,
  validateExpose,
  type ExposeDocument,
  type ValidationIssue,
} from "@/domain/expose/schema";
import type { StoragePort } from "@/infra";

export interface PublishVariant {
  format: VariantFormat;
  width: number | null;
  height: number | null;
  /** Omitted when the server already has the asset (see findKnownAssets). */
  data?: Uint8Array;
}

export interface PublishFile {
  /** Path as written in expose.json, e.g. assets/vorher.png. */
  path: string;
  /** sha256 of the original file, before optimisation. */
  sha256: string;
  width: number | null;
  height: number | null;
  variants: PublishVariant[];
}

export interface PublishContext {
  workspaceId: string;
  userId: string;
  apiTokenId?: string | null;
  source: "api" | "cockpit" | "seed";
}

export interface PublishResult {
  exposeId: string;
  versionId: string;
  version: number;
  slug: string;
  refCode: string;
  prospectId: string;
  createdExpose: boolean;
}

export class PublishError extends Error {
  constructor(
    readonly status: 400 | 403 | 409 | 413,
    readonly issues: ValidationIssue[],
  ) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "PublishError";
  }
}

const IMMUTABLE = "public, max-age=31536000, immutable";
const MAX_VARIANTS = 8;
const MAX_DIMENSION = 6000;

/** Which of these hashes the workspace already stores, so the CLI can skip uploading them. */
export async function findKnownAssets(tx: Transaction, workspaceId: string, hashes: string[]) {
  const valid = hashes.filter(isSha256).slice(0, 500);
  if (valid.length === 0) return [];
  const rows = await tx
    .select({ sha256: assets.sha256 })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspaceId), inArray(assets.sha256, valid)));
  return rows.map((row) => row.sha256);
}

/**
 * Validates an exposé, stores its assets and creates a new immutable version
 * (§7.2). Must run inside withTenant(); every statement is subject to RLS.
 * The first publish for a prospect key creates the prospect and the exposé;
 * later publishes add versions and never overwrite prospect data edited in
 * the cockpit.
 */
export async function publishExpose(
  tx: Transaction,
  storage: StoragePort,
  context: PublishContext,
  input: { document: unknown; files: PublishFile[] },
): Promise<PublishResult> {
  const validation = validateExpose(input.document);
  if (!validation.ok) throw new PublishError(400, validation.issues);
  const document = validation.document;

  const filesByPath = new Map(input.files.map((file) => [file.path, file]));
  const needed = collectAssetPaths(document);
  const missing = needed.filter((path) => !filesByPath.has(path));
  if (missing.length > 0) {
    throw new PublishError(
      400,
      missing.map((path) => ({ path, message: "Datei fehlt im Upload." })),
    );
  }

  const neededFiles = needed.map((path) => filesByPath.get(path)!);
  const known = new Set(
    await findKnownAssets(
      tx,
      context.workspaceId,
      neededFiles.map((file) => file.sha256),
    ),
  );

  // Validate and store new assets.
  const issues: ValidationIssue[] = [];
  const toInsert: (typeof assets.$inferInsert)[] = [];
  const planned = new Set<string>();
  for (const file of neededFiles) {
    if (!isSha256(file.sha256)) {
      issues.push({ path: file.path, message: "Ungültige sha256-Prüfsumme." });
      continue;
    }
    if (known.has(file.sha256) || planned.has(file.sha256)) continue;
    const kind = assetKindForPath(file.path);
    const fileIssues = checkUpload(file, kind);
    if (fileIssues.length > 0) {
      issues.push(...fileIssues);
      continue;
    }
    planned.add(file.sha256);
    const variants: AssetVariant[] = file.variants.map((variant) => ({
      key: variantKey(context.workspaceId, file.sha256, variant.format, variant.width),
      format: variant.format,
      width: variant.width,
      height: variant.height,
      bytes: variant.data!.byteLength,
    }));
    toInsert.push({
      workspaceId: context.workspaceId,
      sha256: file.sha256,
      kind,
      originalName: file.path.slice("assets/".length),
      width: file.width,
      height: file.height,
      bytes: variants.reduce((sum, variant) => sum + variant.bytes, 0),
      variants,
    });
  }
  if (issues.length > 0) throw new PublishError(400, issues);

  for (const file of neededFiles) {
    if (!planned.has(file.sha256)) continue;
    await Promise.all(
      file.variants.map((variant) =>
        storage.put(
          variantKey(context.workspaceId, file.sha256, variant.format, variant.width),
          variant.data!,
          { contentType: CONTENT_TYPES[variant.format], cacheControl: IMMUTABLE },
        ),
      ),
    );
  }
  if (toInsert.length > 0) {
    await tx.insert(assets).values(toInsert).onConflictDoNothing();
  }

  const assetRows =
    neededFiles.length === 0
      ? []
      : await tx
          .select()
          .from(assets)
          .where(
            and(
              eq(assets.workspaceId, context.workspaceId),
              inArray(
                assets.sha256,
                neededFiles.map((file) => file.sha256),
              ),
            ),
          );
  const assetsBySha = new Map(assetRows.map((row) => [row.sha256, row]));
  const manifest: AssetManifest = {};
  for (const file of neededFiles) {
    const row = assetsBySha.get(file.sha256);
    if (!row) throw new Error(`asset ${file.sha256} vanished`);
    manifest[file.path] = {
      assetId: row.id,
      kind: row.kind,
      width: row.width,
      height: row.height,
      variants: row.variants,
    };
  }

  const prospectId = await upsertProspect(tx, context.workspaceId, document.prospect);

  // One exposé per prospect; lock it so concurrent publishes number versions correctly.
  let [expose] = await tx
    .select()
    .from(exposes)
    .where(and(eq(exposes.workspaceId, context.workspaceId), eq(exposes.prospectId, prospectId)))
    .for("update");
  let createdExpose = false;
  if (!expose) {
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(exposes)
      .where(eq(exposes.workspaceId, context.workspaceId));
    const limit = entitlements({ id: context.workspaceId }).limits.publishedExposes;
    if (!withinLimit(limit, count)) {
      throw new PublishError(403, [
        { path: "(Workspace)", message: "Das Limit für Exposés in Ihrem Plan ist erreicht." },
      ]);
    }
    for (let attempt = 0; attempt < 8 && !expose; attempt++) {
      [expose] = await tx
        .insert(exposes)
        .values({
          workspaceId: context.workspaceId,
          prospectId,
          slug: exposeSlug(document.prospect.key),
          refCode: refCode(attempt < 4 ? 4 : 5),
          title: document.meta.title,
        })
        .onConflictDoNothing()
        .returning();
    }
    if (!expose) throw new Error("could not allocate exposé slug/ref code");
    createdExpose = true;
  }

  const [{ latest } = { latest: 0 }] = await tx
    .select({ latest: max(exposeVersions.version) })
    .from(exposeVersions)
    .where(eq(exposeVersions.exposeId, expose.id));
  const version = (latest ?? 0) + 1;

  const [created] = await tx
    .insert(exposeVersions)
    .values({
      workspaceId: context.workspaceId,
      exposeId: expose.id,
      version,
      schemaVersion: EXPOSE_SCHEMA_VERSION,
      document,
      assetManifest: manifest,
      source: context.source,
      publishedByUserId: context.userId,
      apiTokenId: context.apiTokenId ?? null,
    })
    .returning({ id: exposeVersions.id });
  if (!created) throw new Error("version insert returned nothing");

  await tx
    .update(exposes)
    .set({ currentVersionId: created.id, title: document.meta.title, unpublishedAt: null })
    .where(eq(exposes.id, expose.id));

  const newBytes = toInsert.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
  await tx.insert(usageEvents).values([
    {
      workspaceId: context.workspaceId,
      kind: "expose.published",
      meta: { exposeId: expose.id, version },
    },
    ...(newBytes > 0
      ? [{ workspaceId: context.workspaceId, kind: "storage.bytes", quantity: newBytes }]
      : []),
  ]);
  await tx.insert(auditLog).values({
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    action: "expose.published",
    targetType: "expose",
    targetId: expose.id,
    meta: { version, source: context.source, apiTokenId: context.apiTokenId ?? null },
  });

  return {
    exposeId: expose.id,
    versionId: created.id,
    version,
    slug: expose.slug,
    refCode: expose.refCode,
    prospectId,
    createdExpose,
  };
}

function checkUpload(file: PublishFile, kind: AssetKind): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (message: string) => issues.push({ path: file.path, message });
  const formats = allowedFormats(kind);
  if (file.variants.length === 0 || file.variants.length > MAX_VARIANTS) {
    add(`1 bis ${MAX_VARIANTS} Varianten erwartet.`);
    return issues;
  }
  if (kind === "image") {
    if (!file.variants.some((variant) => variant.format === "webp")) {
      add("Bilder brauchen mindestens eine WebP-Variante.");
    }
    if (!file.width || !file.height) add("Bildmaße fehlen.");
  }
  const seen = new Set<string>();
  for (const variant of file.variants) {
    const id = `${variant.format}@${variant.width ?? "file"}`;
    if (seen.has(id)) add(`Variante ${id} ist doppelt.`);
    seen.add(id);
    if (!formats.includes(variant.format)) {
      add(`Format ${variant.format} ist für ${kind} nicht erlaubt.`);
      continue;
    }
    if (!variant.data) {
      add(`Variante ${id} fehlt im Upload.`);
      continue;
    }
    if (variant.data.byteLength > MAX_BYTES[kind]) {
      add(`Variante ${id} ist größer als ${Math.round(MAX_BYTES[kind] / 1024 / 1024)} MB.`);
    }
    if (sniffFormat(variant.data) !== variant.format) {
      add(`Variante ${id}: Inhalt passt nicht zum Format ${variant.format}.`);
    }
    if (kind === "image") {
      const ok =
        Number.isInteger(variant.width) &&
        Number.isInteger(variant.height) &&
        variant.width! > 0 &&
        variant.height! > 0 &&
        variant.width! <= MAX_DIMENSION &&
        variant.height! <= MAX_DIMENSION;
      if (!ok) add(`Variante ${id}: ungültige Bildmaße.`);
    } else if (variant.width !== null) {
      add(`Variante ${id}: Breite nur für Bilder.`);
    }
  }
  return issues;
}

async function upsertProspect(
  tx: Transaction,
  workspaceId: string,
  prospect: ExposeDocument["prospect"],
): Promise<string> {
  const [created] = await tx
    .insert(prospects)
    .values({
      workspaceId,
      key: prospect.key,
      companyName: prospect.company,
      industry: prospect.industry ?? null,
      website: prospect.website ?? null,
      street: prospect.address?.street ?? null,
      postalCode: prospect.address?.postalCode ?? null,
      city: prospect.address?.city ?? null,
      country: prospect.address?.country ?? "DE",
      phone: prospect.phone ?? null,
      email: prospect.email ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: prospects.id });
  if (created) {
    const contact = prospect.contact;
    if (contact && (contact.firstName || contact.lastName)) {
      await tx.insert(contacts).values({
        workspaceId,
        prospectId: created.id,
        salutation: contact.salutation || null,
        firstName: contact.firstName ?? null,
        lastName: contact.lastName ?? null,
        role: contact.role ?? null,
        isPrimary: true,
      });
    }
    return created.id;
  }
  const [existing] = await tx
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.key, prospect.key)));
  if (!existing) throw new Error("prospect upsert failed");
  return existing.id;
}
