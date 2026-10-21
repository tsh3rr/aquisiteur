import { getDb } from "@/db";
import { saveReturnChannel } from "@/server/chat/visitor";
import { empty, json, publicPost } from "@/server/tracking/http";

/** The visitor's return channel for the chat (§7.5). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) => {
    const result = await saveReturnChannel(getDb(), { workspaceId, body });
    if ("ok" in result) return empty(204);
    if (result.error === "limited") return empty(429);
    if (result.error === "blocked") return empty(403);
    return json(result, 400);
  });
}
