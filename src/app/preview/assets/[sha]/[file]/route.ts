import {
  CONTENT_TYPES,
  isSha256,
  parseVariantFileName,
  variantKey,
} from "@/domain/expose/asset-files";
import { getInfra } from "@/infra";
import { requireCockpit } from "@/server/session";

/** Exposé files for the cockpit preview, scoped to the signed-in workspace. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sha: string; file: string }> },
) {
  const { sha, file } = await params;
  const parsed = parseVariantFileName(file);
  if (!isSha256(sha) || !parsed) return new Response("Not found", { status: 404 });
  const { workspace } = await requireCockpit();
  const object = await getInfra().storage.get(
    variantKey(workspace.id, sha, parsed.format, parsed.width),
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
