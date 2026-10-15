import { getDb } from "@/db";
import { workspaceForHostParam } from "@/server/sites";
import { isCrossSite, noStore, ownerDeviceFor, readJson } from "@/server/tracking/http";
import { startVisit } from "@/server/tracking/visits";

const STATUS = { invalid: 400, not_found: 404, limited: 429 } as const;

/** The exposé's script reports in and receives its visit token (§6.3). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const workspace = await workspaceForHostParam((await params).host);
  if (!workspace) return new Response("Not found", { status: 404 });
  const result = await startVisit(getDb(), {
    workspaceId: workspace.id,
    body: await readJson(request),
    headers: request.headers,
    internal: await ownerDeviceFor(workspace.id),
  });
  if ("error" in result)
    return new Response(null, { status: STATUS[result.error], headers: noStore });
  return Response.json(result, { headers: noStore });
}
