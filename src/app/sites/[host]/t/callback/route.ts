import { getDb } from "@/db";
import { createCallbackRequest } from "@/server/chat/visitor";
import { empty, json, ownerDeviceFor, publicPost } from "@/server/tracking/http";

/** „Rückruf anfordern“ from the contact block (§7.4). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) => {
    const result = await createCallbackRequest(getDb(), {
      workspaceId,
      body,
      internal: await ownerDeviceFor(workspaceId),
    });
    if ("ok" in result) return empty(201);
    if (result.error === "invalid") return json(result, 400);
    return empty(result.error === "limited" ? 429 : 404);
  });
}
