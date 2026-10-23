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
  ASSET_PATH_PATTERN,
  collectAssetPaths,
  EXPOSE_SCHEMA_VERSION,
  validateExpose,
  type ExposeDocument,
  type ValidationIssue,
} from "@/domain/expose/schema";
import type { StoragePort } from "@/infra";
import { withOfferPricing } from "../offers/pricing";
import { ensureProject } from "../projects";
import { ensureLetterTouchpoint } from "../tracking/touchpoints";

export interface PublishVariant {
  format: VariantFormat;
  width: number | null;
  height: number | null;
  /** Omitted when only describing an asset the server already stores. */
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
  /** Codes printed on the letter (§6.2). */
  letter: { qrToken: string; shortCode: string | null };
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
 * Stores one asset (all its renditions) unless the workspace already has a
 * file with the same hash. Must run inside withTenant().
 */
export async function storeAsset(
  tx: Transaction,
  storage: StoragePort,
  context: PublishContext,
  file: PublishFile,
): Promise<{ assetId: string; created: boolean }> {
  if (!isSha256(file.sha256)) {
    throw new PublishError(400, [{ path: file.path, message: "Ungültige sha256-Prüfsumme." }]);
  }
  if (!ASSET_PATH_PATTERN.test(file.path)) {
    throw new PublishError(400, [{ path: file.path, message: "Ungültiger Asset-Pfad." }]);
  }
  const existing = await findAsset(tx, context.workspaceId, file.sha256);
  if (existing) return { assetId: existing.id, created: false };

  const kind = assetKindForPath(file.path);
  const issues = checkUpload(file, kind);
  if (issues.length > 0) throw new PublishError(400, issues);

  await Promise.all(
    file.variants.map((variant) =>
      storage.put(
        variantKey(context.workspaceId, file.sha256, variant.format, variant.width),
        variant.data!,
        { contentType: CONTENT_TYPES[variant.format], cacheControl: IMMUTABLE },
      ),
    ),
  );
  const variants: AssetVariant[] = file.variants.map((variant) => ({
    key: variantKey(context.workspaceId, file.sha256, variant.format, variant.width),
    format: variant.format,
    width: variant.width,
    height: variant.height,
    bytes: variant.data!.byteLength,
  }));
  const bytes = variants.reduce((sum, variant) => sum + variant.bytes, 0);
  const [inserted] = await tx
    .insert(assets)
    .values({
      workspaceId: context.workspaceId,
      sha256: file.sha256,
      kind,
      originalName: file.path.slice("assets/".length),
      width: file.width,
      height: file.height,
      bytes,
      variants,
    })
    .onConflictDoNothing()
    .returning({ id: assets.id });
  if (!inserted) {
    const raced = await findAsset(tx, context.workspaceId, file.sha256);
    if (!raced) throw new Error("asset insert failed");
    return { assetId: raced.id, created: false };
  }
  await tx
    .insert(usageEvents)
    .values({ workspaceId: context.workspaceId, kind: "storage.bytes", quantity: bytes });
  return { assetId: inserted.id, created: true };
}

async function findAsset(tx: Transaction, workspaceId: string, sha256: string) {
  const [row] = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspaceId), eq(assets.sha256, sha256)));
  return row ?? null;
}

/**
 * Validates an exposé and creates a new immutable version (§7.2). Every
 * referenced asset must have been stored before (storeAsset). Must run
 * inside withTenant(); every statement is subject to RLS. The first publish
 * for a prospect key creates the prospect and the exposé; later publishes
 * add versions and never overwrite prospect data edited in the cockpit.
 */
export async function publishExpose(
  tx: Transaction,
  context: PublishContext,
  input: { document: unknown; assets: { path: string; sha256: string }[] },
): Promise<PublishResult> {
  const validation = validateExpose(input.document);
  if (!validation.ok) throw new PublishError(400, validation.issues);
  const document = validation.document;

  const hashByPath = new Map(input.assets.map((asset) => [asset.path, asset.sha256]));
  const needed = collectAssetPaths(document);
  const issues: ValidationIssue[] = needed
    .filter((path) => !hashByPath.has(path))
    .map((path) => ({ path, message: "Datei fehlt im Upload." }));
  if (issues.length > 0) throw new PublishError(400, issues);

  const hashes = [...new Set(needed.map((path) => hashByPath.get(path)!))].filter(isSha256);
  const assetRows =
    hashes.length === 0
      ? []
      : await tx
          .select()
          .from(assets)
          .where(and(eq(assets.workspaceId, context.workspaceId), inArray(assets.sha256, hashes)));
  const assetsBySha = new Map(assetRows.map((row) => [row.sha256, row]));
  const manifest: AssetManifest = {};
  for (const path of needed) {
    const row = assetsBySha.get(hashByPath.get(path)!);
    if (!row) {
      issues.push({ path, message: "Datei wurde noch nicht hochgeladen." });
      continue;
    }
    const expected = assetKindForPath(path);
    if (row.kind !== expected) {
      issues.push({ path, message: `Datei ist kein ${expected}.` });
      continue;
    }
    manifest[path] = {
      assetId: row.id,
      kind: row.kind,
      width: row.width,
      height: row.height,
      variants: row.variants,
    };
  }
  if (issues.length > 0) throw new PublishError(400, issues);

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
    const projectId = await ensureProject(tx, context.workspaceId, prospectId);
    for (let attempt = 0; attempt < 8 && !expose; attempt++) {
      [expose] = await tx
        .insert(exposes)
        .values({
          workspaceId: context.workspaceId,
          prospectId,
          projectId,
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
  const projectId = expose.projectId ?? (await ensureProject(tx, context.workspaceId, prospectId));
  // A pricing block with "source": "offer" shows the project's current offer (§7.10).
  const rendered = await withOfferPricing(tx, context.workspaceId, projectId, document);

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
      document: rendered,
      assetManifest: manifest,
      source: context.source,
      publishedByUserId: context.userId,
      apiTokenId: context.apiTokenId ?? null,
    })
    .returning({ id: exposeVersions.id });
  if (!created) throw new Error("version insert returned nothing");

  await tx
    .update(exposes)
    .set({
      currentVersionId: created.id,
      title: document.meta.title,
      unpublishedAt: null,
      projectId,
    })
    .where(eq(exposes.id, expose.id));

  await tx.insert(usageEvents).values({
    workspaceId: context.workspaceId,
    kind: "expose.published",
    meta: { exposeId: expose.id, version },
  });
  await tx.insert(auditLog).values({
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    action: "expose.published",
    targetType: "expose",
    targetId: expose.id,
    meta: { version, source: context.source, apiTokenId: context.apiTokenId ?? null },
  });

  const letter = await ensureLetterTouchpoint(tx, {
    workspaceId: context.workspaceId,
    prospectId,
    exposeId: expose.id,
    userId: context.userId,
  });

  return {
    exposeId: expose.id,
    versionId: created.id,
    version,
    slug: expose.slug,
    refCode: expose.refCode,
    prospectId,
    createdExpose,
    letter: { qrToken: letter.qrToken, shortCode: letter.shortCode },
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
    if (!file.variants.some((variant) => variant.format === "webp" || variant.format === "png")) {
      add("Bilder brauchen mindestens eine WebP- oder PNG-Variante.");
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
    .select({ id: prospects.id, restrictedAt: prospects.restrictedAt })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.key, prospect.key)));
  if (!existing) throw new Error("prospect upsert failed");
  // Sperrvermerk (ADR-0071): the customer asked to be deleted; no new exposé.
  if (existing.restrictedAt) {
    throw new PublishError(409, [
      {
        path: "prospect.key",
        message: "Für diesen Kunden gilt ein Sperrvermerk. Ein neues Exposé ist nicht möglich.",
      },
    ]);
  }
  return existing.id;
}
