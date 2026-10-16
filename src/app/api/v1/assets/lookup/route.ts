import { can } from "@/domain/authz";
import { assetLookupSchema } from "@/domain/expose/wire";
import { readTextLimited } from "@/lib/body";
import { apiError, authenticateApiRequest } from "@/server/api-auth";
import { findKnownAssets } from "@/server/exposes/publish";

/** Which assets the workspace already stores, so the CLI uploads only new files. */
export async function POST(request: Request) {
  const api = await authenticateApiRequest(request);
  if (!api) return apiError(401, "invalid_token");
  if (!can(api.actor, "exposes.publish", { workspaceId: api.actor.workspaceId })) {
    return apiError(403, "forbidden");
  }
  const text = await readTextLimited(request, 256 * 1024);
  if (text === null) return apiError(413, "payload_too_large");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Reported as invalid_request below.
  }
  const parsed = assetLookupSchema.safeParse(json);
  if (!parsed.success) return apiError(400, "invalid_request");
  const known = await api.tenant((tx) =>
    findKnownAssets(tx, api.actor.workspaceId, parsed.data.sha256),
  );
  return Response.json({ known }, { headers: { "cache-control": "no-store" } });
}
