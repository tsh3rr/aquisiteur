import { getDb } from "@/db";
import { empty, publicPost } from "@/server/tracking/http";
import { recordConsent } from "@/server/tracking/replay";

const STATUS = { ok: 204, invalid: 400, limited: 429, disabled: 409 } as const;

/** The visitor's answer to the replay notice (§9). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) =>
    empty(STATUS[await recordConsent(getDb(), { workspaceId, body })]),
  );
}
