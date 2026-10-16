import { getDb } from "@/db";
import { postVisitorMessage } from "@/server/chat/visitor";
import { empty, json, publicPost } from "@/server/tracking/http";

/** A visitor's chat message; the first one opens the thread (§7.5). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) => {
    const result = await postVisitorMessage(getDb(), { workspaceId, body });
    if ("error" in result) return empty(result.error === "limited" ? 429 : 400);
    return json(result, 201);
  });
}
