"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, withTenant, type Transaction } from "@/db";
import { auditLog, workspaceSettings } from "@/db/schema";
import { can } from "@/domain/authz";
import { parseVariantFileName, sha256Hex, sniffFormat } from "@/domain/expose/asset-files";
import { getInfra } from "@/infra";
import type { BrandImageKind } from "@/server/brand-images";
import { PublishError, storeAsset, type PublishVariant } from "@/server/exposes/publish";
import { getWorkspaceContext } from "@/server/session";

export interface BrandImageResult {
  ok: boolean;
  error?: string;
}

const TARGET = {
  photo: { column: "profile", key: "photoAssetId", fileName: "profilfoto" },
  logo: { column: "branding", key: "logoAssetId", fileName: "logo" },
  signature: { column: "letter", key: "signatureAssetId", fileName: "unterschrift" },
} as const;

const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

function isKind(value: unknown): value is BrandImageKind {
  return value === "photo" || value === "logo" || value === "signature";
}

/** Runs `fn` as tenant after checking the member may change settings. */
async function asSettingsEditor<T>(
  fn: (tx: Transaction, workspaceId: string, userId: string) => Promise<T>,
): Promise<T | null> {
  const { user, active } = await getWorkspaceContext();
  if (!active) return null;
  const actor = { userId: user.id, role: active.role, workspaceId: active.id };
  if (!can(actor, "settings.update", { workspaceId: active.id })) return null;
  return withTenant(getDb(), { userId: user.id, workspaceId: active.id }, (tx) =>
    fn(tx, active.id, user.id),
  );
}

async function setImage(
  tx: Transaction,
  workspaceId: string,
  userId: string,
  kind: BrandImageKind,
  assetId: string | null,
) {
  const { column, key } = TARGET[kind];
  const current = workspaceSettings[column];
  const next =
    assetId === null
      ? sql`${current} - ${key}::text`
      : sql`${current} || ${JSON.stringify({ [key]: assetId })}::jsonb`;
  await tx
    .update(workspaceSettings)
    .set({ [column]: next })
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  await tx.insert(auditLog).values({
    workspaceId,
    actorUserId: userId,
    action: "settings.updated",
    targetType: "workspace",
    targetId: workspaceId,
    meta: { fields: [`${column}.${key}`] },
  });
}

/**
 * Stores the owner photo or agency logo. The browser already scaled the
 * image and sends WebP (or PNG) renditions named like "480.webp"; the
 * server checks every part's real format before storing it.
 */
export async function uploadBrandImage(formData: FormData): Promise<BrandImageResult> {
  const kind = formData.get("kind");
  if (!isKind(kind)) return { ok: false, error: "Unbekannte Bildart." };

  const parts = formData.getAll("variant").filter((part): part is File => part instanceof File);
  const total = parts.reduce((sum, part) => sum + part.size, 0);
  if (parts.length === 0 || parts.length > 4 || total > MAX_TOTAL_BYTES) {
    return { ok: false, error: "Das Bild ist zu groß. Bitte ein kleineres wählen." };
  }
  const width = Number(formData.get("width"));
  const height = Number(formData.get("height"));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { ok: false, error: "Bildmaße fehlen." };
  }

  const variants: PublishVariant[] = [];
  for (const part of parts) {
    const name = parseVariantFileName(part.name);
    const data = new Uint8Array(await part.arrayBuffer());
    if (!name?.width || sniffFormat(data) !== name.format) {
      return { ok: false, error: "Das Bild konnte nicht gelesen werden." };
    }
    variants.push({
      format: name.format,
      width: name.width,
      height: Math.round((name.width * height) / width),
      data,
    });
  }
  const largest = variants.reduce((a, b) => (b.width! > a.width! ? b : a));

  try {
    const done = await asSettingsEditor(async (tx, workspaceId, userId) => {
      const { assetId } = await storeAsset(
        tx,
        getInfra().storage,
        { workspaceId, userId, source: "cockpit" },
        {
          path: `assets/${TARGET[kind].fileName}.${largest.format}`,
          sha256: await sha256Hex(largest.data!),
          width: largest.width,
          height: largest.height,
          variants,
        },
      );
      await setImage(tx, workspaceId, userId, kind, assetId);
      return true;
    });
    if (!done) return { ok: false, error: "Sie dürfen die Einstellungen nicht ändern." };
  } catch (error) {
    if (error instanceof PublishError) {
      return { ok: false, error: error.issues[0]?.message ?? "Das Bild wurde abgelehnt." };
    }
    throw error;
  }
  revalidatePath("/settings");
  revalidatePath("/onboarding");
  return { ok: true };
}

/** Removes the owner photo or logo from the settings. The stored file stays (versions use it). */
export async function removeBrandImage(kind: BrandImageKind): Promise<BrandImageResult> {
  if (!isKind(kind)) return { ok: false, error: "Unbekannte Bildart." };
  const done = await asSettingsEditor(async (tx, workspaceId, userId) => {
    await setImage(tx, workspaceId, userId, kind, null);
    return true;
  });
  if (!done) return { ok: false, error: "Sie dürfen die Einstellungen nicht ändern." };
  revalidatePath("/settings");
  revalidatePath("/onboarding");
  return { ok: true };
}
