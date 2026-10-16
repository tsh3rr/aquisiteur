import {
  CONTENT_TYPES,
  isSha256,
  parseVariantFileName,
  variantKey,
} from "@/domain/expose/asset-files";
import { getInfra } from "@/infra";
import { getWorkspaceContext } from "@/server/session";

/**
 * Workspace files for the cockpit (exposé preview, profile photo, logo),
 * scoped to the signed-in member's active workspace. Also used during
 * onboarding, so it does not require a finished setup.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sha: string; file: string }> },
) {
  const { sha, file } = await params;
  const parsed = parseVariantFileName(file);
  if (!isSha256(sha) || !parsed) return new Response("Not found", { status: 404 });
  const { active } = await getWorkspaceContext();
  if (!active) return new Response("Not found", { status: 404 });
  const object = await getInfra().storage.get(
    variantKey(active.id, sha, parsed.format, parsed.width),
  );
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": CONTENT_TYPES[parsed.format],
      "cache-control": "private, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
