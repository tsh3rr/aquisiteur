import { getDb } from "@/db";
import { chatClient } from "@/server/chat/guard";
import { createCallbackRequest } from "@/server/chat/visitor";
import { empty, json, ownerDeviceFor, publicPost } from "@/server/tracking/http";

const status = { not_found: 404, limited: 429, blocked: 403, challenge: 428 } as const;

/** „Rückruf anfordern“ from the contact block (§7.4, guards: ADR-0066). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) => {
    const result = await createCallbackRequest(getDb(), {
      workspaceId,
      body,
      internal: await ownerDeviceFor(workspaceId),
      client: await chatClient(request.headers),
    });
    if ("ok" in result) return empty(201);
    if (result.error === "invalid") return json(result, 400);
    return empty(status[result.error]);
  });
}
