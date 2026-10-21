import { getDb } from "@/db";
import { chatClient } from "@/server/chat/guard";
import { postVisitorMessage } from "@/server/chat/visitor";
import { empty, json, publicPost } from "@/server/tracking/http";

const status = { invalid: 400, rejected: 422, challenge: 428, blocked: 403, limited: 429 } as const;

/** A visitor's chat message; the first one opens the thread (§7.5, guards: ADR-0066). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) => {
    const result = await postVisitorMessage(getDb(), {
      workspaceId,
      body,
      client: await chatClient(request.headers),
    });
    if (!("error" in result)) return json(result, 201);
    if (result.error === "invalid") return empty(400);
    return json(result, status[result.error]);
  });
}
