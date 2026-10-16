import { can } from "@/domain/authz";
import { assetUploadMetaSchema, MAX_UPLOAD_BYTES } from "@/domain/expose/wire";
import { getInfra } from "@/infra";
import { readBodyLimited } from "@/lib/body";
import { apiError, authenticateApiRequest } from "@/server/api-auth";
import { PublishError, storeAsset, type PublishVariant } from "@/server/exposes/publish";

/** POST /api/v1/assets: upload one exposé asset with all its renditions. */
export async function POST(request: Request) {
  const api = await authenticateApiRequest(request);
  if (!api) return apiError(401, "invalid_token");
  if (!can(api.actor, "exposes.publish", { workspaceId: api.actor.workspaceId })) {
    return apiError(403, "forbidden");
  }
  const body = await readBodyLimited(request, MAX_UPLOAD_BYTES);
  if (!body) return apiError(413, "payload_too_large");

  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    return apiError(400, "invalid_request");
  }
  const metaField = form.get("meta");
  let metaJson: unknown;
  try {
    metaJson = JSON.parse(typeof metaField === "string" ? metaField : "");
  } catch {
    return apiError(400, "invalid_request");
  }
  const meta = assetUploadMetaSchema.safeParse(metaJson);
  if (!meta.success) return apiError(400, "invalid_request");

  const variants: PublishVariant[] = [];
  for (const variant of meta.data.variants) {
    const part = form.get(variant.part);
    if (!(part instanceof Blob)) {
      return apiError(400, "invalid_request", [
        { path: meta.data.path, message: `Teil ${variant.part} fehlt.` },
      ]);
    }
    variants.push({
      format: variant.format,
      width: variant.width,
      height: variant.height,
      data: new Uint8Array(await part.arrayBuffer()),
    });
  }

  try {
    const result = await api.tenant((tx) =>
      storeAsset(
        tx,
        getInfra().storage,
        {
          workspaceId: api.actor.workspaceId,
          userId: api.actor.userId,
          apiTokenId: api.tokenId,
          source: "api",
        },
        { ...meta.data, variants },
      ),
    );
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof PublishError) return apiError(error.status, "invalid_asset", error.issues);
    throw error;
  }
}
