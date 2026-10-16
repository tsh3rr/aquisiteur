import { getDb } from "@/db";
import { sendOfflineNotice } from "@/server/chat/visitor";
import { empty, json, publicPost } from "@/server/tracking/http";

/** Asks for the automatic notice after two unanswered minutes; the server decides (§7.5). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) => {
    const result = await sendOfflineNotice(getDb(), { workspaceId, body });
    return result ? json(result) : empty(404);
  });
}
