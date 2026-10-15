import {
  CONTENT_TYPES,
  isSha256,
  parseVariantFileName,
  variantKey,
} from "@/domain/expose/asset-files";
import { getInfra } from "@/infra";
import { workspaceForHostParam } from "@/server/sites";

/**
 * Exposé files on the workspace's own host: /assets/<sha256>/<width>.<format>.
 * The storage key is derived from the host's workspace, so one workspace can
 * never serve another's files. Content-addressed, hence cached forever.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ host: string; sha: string; file: string }> },
) {
  const { host, sha, file } = await params;
  const parsed = parseVariantFileName(file);
  if (!isSha256(sha) || !parsed) return new Response("Not found", { status: 404 });
  const workspace = await workspaceForHostParam(host);
  if (!workspace) return new Response("Not found", { status: 404 });
  const object = await getInfra().storage.get(
    variantKey(workspace.id, sha, parsed.format, parsed.width),
  );
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": CONTENT_TYPES[parsed.format],
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-site",
      ...(object.size ? { "content-length": String(object.size) } : {}),
    },
  });
}
