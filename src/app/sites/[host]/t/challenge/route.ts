import { getDb } from "@/db";
import { issueChallenge } from "@/server/chat/guard";
import { empty, json, publicPost } from "@/server/tracking/http";

const status = { invalid: 400, limited: 429, blocked: 403 } as const;

/** A proof-of-work challenge for the chat or the callback form (ADR-0066). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) => {
    const result = await issueChallenge(getDb(), { workspaceId, body });
    if ("error" in result) return empty(status[result.error]);
    return json(result);
  });
}
