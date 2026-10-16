import { loadReplayEvents } from "@/server/tracking/replay";
import { requireCockpit } from "@/server/session";

/** The recorded events for the player; tenant-scoped, never cached. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; replayId: string }> },
) {
  const { id, replayId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(replayId)) return new Response("Not found", { status: 404 });
  const { workspace, tenant } = await requireCockpit();
  const replay = await tenant((tx) => loadReplayEvents(tx, workspace.id, replayId));
  if (!replay || replay.prospectId !== id) return new Response("Not found", { status: 404 });
  return Response.json(replay.events, { headers: { "cache-control": "private, no-store" } });
}
