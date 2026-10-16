import { getDb } from "@/db";
import { readVisitorThread } from "@/server/chat/visitor";
import { empty, json, publicPost } from "@/server/tracking/http";

/** The thread so far, after a reload or reconnect (§7.5). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) => {
    const result = await readVisitorThread(getDb(), { workspaceId, body });
    return result ? json(result) : empty(404);
  });
}
