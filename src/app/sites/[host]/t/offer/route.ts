import { getDb } from "@/db";
import { answerOffer } from "@/server/offers/public";
import { empty, json, ownerDeviceFor, publicPost } from "@/server/tracking/http";

const status = { not_found: 404, limited: 429, closed: 409, outdated: 409 } as const;

/** Accept or decline on the offer page `/a/<token>` (§7.10). */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  return publicPost(request, params, async (workspaceId, body) => {
    const { token, ...answer } = (body && typeof body === "object" ? body : {}) as {
      token?: unknown;
    };
    if (typeof token !== "string") return empty(404);
    const result = await answerOffer(getDb(), {
      workspaceId,
      token,
      body: answer,
      internal: await ownerDeviceFor(workspaceId),
    });
    if ("ok" in result) return json({ status: result.status });
    if (result.error === "invalid") return json(result, 400);
    return empty(status[result.error]);
  });
}
