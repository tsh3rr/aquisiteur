import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@/db";
import { assets } from "@/db/schema";
import type { WorkspaceSettings } from "@/domain/workspace-settings";
import { resolveEntry } from "@/components/expose/render-context";

export type BrandImageKind = "photo" | "logo";

export interface BrandImagePreview {
  src: string;
  srcSet: string;
  width: number;
  height: number;
}

/** Owner photo and agency logo of a workspace, as cockpit-served image URLs. */
export async function loadBrandImages(
  tx: Transaction,
  workspaceId: string,
  settings: WorkspaceSettings,
): Promise<Record<BrandImageKind, BrandImagePreview | null>> {
  const ids = {
    photo: settings.profile.photoAssetId,
    logo: settings.branding.logoAssetId,
  };
  const wanted = Object.values(ids).filter((id): id is string => Boolean(id));
  const rows =
    wanted.length === 0
      ? []
      : await tx
          .select()
          .from(assets)
          .where(and(eq(assets.workspaceId, workspaceId), inArray(assets.id, wanted)));
  const preview = (id: string | undefined): BrandImagePreview | null => {
    const row = rows.find((candidate) => candidate.id === id);
    const image = row && resolveEntry({ ...row, assetId: row.id }, "/preview/assets", "");
    if (!image) return null;
    return {
      src: image.src,
      srcSet: image.webpSrcSet || image.pngSrcSet,
      width: image.width,
      height: image.height,
    };
  };
  return { photo: preview(ids.photo), logo: preview(ids.logo) };
}
