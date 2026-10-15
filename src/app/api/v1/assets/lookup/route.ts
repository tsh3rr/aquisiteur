import { can } from "@/domain/authz";
import { assetLookupSchema } from "@/domain/expose/wire";
import { apiError, authenticateApiRequest } from "@/server/api-auth";
import { findKnownAssets } from "@/server/exposes/publish";

/** Which assets the workspace already stores, so the CLI uploads only new files. */
export async function POST(request: Request) {
  const api = await authenticateApiRequest(request);
  if (!api) return apiError(401, "invalid_token");
  if (!can(api.actor, "exposes.publish", { workspaceId: api.actor.workspaceId })) {
    return apiError(403, "forbidden");
  }
  const parsed = assetLookupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "invalid_request");
  const known = await api.tenant((tx) =>
    findKnownAssets(tx, api.actor.workspaceId, parsed.data.sha256),
  );
  return Response.json({ known }, { headers: { "cache-control": "no-store" } });
}
