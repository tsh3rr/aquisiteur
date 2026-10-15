import { getDb } from "@/db";
import { workspaceForHostParam } from "@/server/sites";
import { isCrossSite, noStore, readJson } from "@/server/tracking/http";
import { ingestEvents } from "@/server/tracking/visits";

const STATUS = { ok: 204, invalid: 400, limited: 429 } as const;

/** Event batches from the exposé's script, via sendBeacon or fetch (§6.3). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const workspace = await workspaceForHostParam((await params).host);
  if (!workspace) return new Response("Not found", { status: 404 });
  const result = await ingestEvents(getDb(), {
    workspaceId: workspace.id,
    body: await readJson(request),
  });
  return new Response(null, { status: STATUS[result], headers: noStore });
}
