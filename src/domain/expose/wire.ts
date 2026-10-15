import { z } from "zod";

/**
 * Wire format of the exposé API, shared by the routes and the CLI. Assets
 * are uploaded one per request (Workers keep request bodies in memory), the
 * exposé itself is plain JSON that references them by hash:
 *
 * 1. POST /api/v1/assets/lookup  { sha256: [...] }       → { known: [...] }
 * 2. POST /api/v1/assets         multipart: meta + parts  → { assetId }
 * 3. POST /api/v1/exposes        { document, assets }     → PublishResponse
 */
const dimension = z.number().int().positive().max(20_000).nullable();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const assetUploadMetaSchema = z.object({
  path: z.string().max(300),
  sha256,
  width: dimension,
  height: dimension,
  variants: z
    .array(
      z.object({
        format: z.enum(["avif", "webp", "mp4", "webm", "vtt"]),
        width: dimension,
        height: dimension,
        /** Name of the multipart field carrying the bytes. */
        part: z.string().regex(/^p\d{1,2}$/),
      }),
    )
    .min(1)
    .max(8),
});
export type AssetUploadMeta = z.infer<typeof assetUploadMetaSchema>;

export const assetLookupSchema = z.object({ sha256: z.array(sha256).max(500) });

export const publishRequestSchema = z.object({
  document: z.unknown(),
  assets: z.array(z.object({ path: z.string().max(300), sha256 })).max(200),
});

/** Largest single upload request (one asset with all renditions). */
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export interface PublishResponse {
  exposeId: string;
  version: number;
  url: string;
  previewUrl: string;
  refCode: string;
  createdExpose: boolean;
}
