import { getDb } from "@/db";
import { REPLAY_LIMITS } from "@/domain/tracking/replay";
import { readTextLimited } from "@/lib/body";
import { workspaceForHostParam } from "@/server/sites";
import { empty, isCrossSite } from "@/server/tracking/http";
import { appendReplayChunk } from "@/server/tracking/replay";

const STATUS = { ok: 204, invalid: 400, limited: 429, forbidden: 403, full: 413 } as const;

/** Recording chunks (rrweb) after consent; see src/server/tracking/replay.ts. */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  if (isCrossSite(request)) return empty(403);
  const workspace = await workspaceForHostParam((await params).host);
  if (!workspace) return empty(404);
  const text = await readTextLimited(request, REPLAY_LIMITS.chunkBytes);
  if (text === null) return empty(413);
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return empty(400);
  }
  const result = await appendReplayChunk(getDb(), {
    workspaceId: workspace.id,
    body,
    rawBytes: new TextEncoder().encode(text).byteLength,
  });
  return empty(STATUS[result]);
}
