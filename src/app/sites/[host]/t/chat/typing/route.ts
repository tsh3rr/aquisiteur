import { getDb } from "@/db";
import { recordVisitorTyping } from "@/server/chat/visitor";
import { empty, publicPost } from "@/server/tracking/http";

const STATUS = { ok: 204, invalid: 400, limited: 429 } as const;

/** Typing indicator and draft length (§7.5). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) =>
    empty(STATUS[await recordVisitorTyping(getDb(), { workspaceId, body })]),
  );
}
