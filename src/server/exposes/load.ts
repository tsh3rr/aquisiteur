import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Database, Transaction } from "@/db";
import {
  assets,
  exposes,
  exposeVersions,
  prospects,
  workspaceSettings,
  workspaces,
  type AssetManifest,
  type ManifestEntry,
} from "@/db/schema";
import type { ExposeDocument } from "@/domain/expose/schema";
import { workspaceSettingsSchema, type WorkspaceSettings } from "@/domain/workspace-settings";

/** Everything the renderer needs for one exposé version. */
export interface ExposeViewData {
  expose: { id: string; slug: string; refCode: string };
  version: { id: string; number: number; createdAt: Date };
  document: ExposeDocument;
  manifest: AssetManifest;
  prospect: { companyName: string };
  workspace: { id: string; name: string };
  settings: WorkspaceSettings;
  ownerPhoto: ManifestEntry | null;
}

type Reader = Database | Transaction;

async function settingsAndPhoto(db: Reader, workspaceId: string) {
  const [row] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  const settings = workspaceSettingsSchema.parse(row ?? {});
  let ownerPhoto: ManifestEntry | null = null;
  if (settings.profile.photoAssetId) {
    const [photo] = await db
      .select()
      .from(assets)
      .where(
        and(eq(assets.id, settings.profile.photoAssetId), eq(assets.workspaceId, workspaceId)),
      );
    if (photo?.kind === "image") {
      ownerPhoto = {
        assetId: photo.id,
        kind: "image",
        width: photo.width,
        height: photo.height,
        variants: photo.variants,
      };
    }
  }
  return { settings, ownerPhoto };
}

/**
 * Public exposé by host-resolved workspace and slug. Runs on the system
 * connection (visitors have no tenant context) and is therefore scoped
 * explicitly: workspace id + slug, published only, and the current version
 * must belong to this exposé.
 */
export async function loadPublicExpose(
  db: Database,
  workspaceId: string,
  slug: string,
): Promise<ExposeViewData | null> {
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  const [row] = await db
    .select({
      expose: { id: exposes.id, slug: exposes.slug, refCode: exposes.refCode },
      version: {
        id: exposeVersions.id,
        number: exposeVersions.version,
        createdAt: exposeVersions.createdAt,
        document: exposeVersions.document,
        manifest: exposeVersions.assetManifest,
      },
      prospect: { companyName: prospects.companyName },
      workspace: { id: workspaces.id, name: workspaces.name },
    })
    .from(exposes)
    .innerJoin(
      exposeVersions,
      and(
        eq(exposeVersions.id, exposes.currentVersionId),
        eq(exposeVersions.exposeId, exposes.id),
        eq(exposeVersions.workspaceId, exposes.workspaceId),
      ),
    )
    .innerJoin(prospects, eq(prospects.id, exposes.prospectId))
    .innerJoin(workspaces, eq(workspaces.id, exposes.workspaceId))
    .where(
      and(
        eq(exposes.workspaceId, workspaceId),
        eq(exposes.slug, slug),
        isNull(exposes.unpublishedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const { settings, ownerPhoto } = await settingsAndPhoto(db, workspaceId);
  return {
    expose: row.expose,
    version: { id: row.version.id, number: row.version.number, createdAt: row.version.createdAt },
    document: row.version.document as ExposeDocument,
    manifest: row.version.manifest,
    prospect: row.prospect,
    workspace: row.workspace,
    settings,
    ownerPhoto,
  };
}

/** Any version of an exposé for the cockpit preview. Runs as tenant (RLS). */
export async function loadExposeVersionForPreview(
  tx: Transaction,
  workspaceId: string,
  exposeId: string,
  versionNumber?: number,
): Promise<ExposeViewData | null> {
  const [row] = await tx
    .select({
      expose: { id: exposes.id, slug: exposes.slug, refCode: exposes.refCode },
      currentVersionId: exposes.currentVersionId,
      prospect: { companyName: prospects.companyName },
      workspace: { id: workspaces.id, name: workspaces.name },
    })
    .from(exposes)
    .innerJoin(prospects, eq(prospects.id, exposes.prospectId))
    .innerJoin(workspaces, eq(workspaces.id, exposes.workspaceId))
    .where(and(eq(exposes.workspaceId, workspaceId), eq(exposes.id, exposeId)));
  if (!row) return null;
  const [version] = await tx
    .select()
    .from(exposeVersions)
    .where(
      and(
        eq(exposeVersions.exposeId, exposeId),
        versionNumber
          ? eq(exposeVersions.version, versionNumber)
          : eq(exposeVersions.id, row.currentVersionId ?? exposeId),
      ),
    );
  if (!version) return null;
  const { settings, ownerPhoto } = await settingsAndPhoto(tx, workspaceId);
  return {
    expose: row.expose,
    version: { id: version.id, number: version.version, createdAt: version.createdAt },
    document: version.document as ExposeDocument,
    manifest: version.assetManifest,
    prospect: row.prospect,
    workspace: row.workspace,
    settings,
    ownerPhoto,
  };
}
