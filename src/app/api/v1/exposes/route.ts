import { eq } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import { workspaces } from "@/db/schema";
import { can } from "@/domain/authz";
import { publishRequestSchema, type PublishResponse } from "@/domain/expose/wire";
import { readTextLimited } from "@/lib/body";
import { apiError, authenticateApiRequest } from "@/server/api-auth";
import { publishExpose, PublishError } from "@/server/exposes/publish";
import { exposePath, workspacePublicOrigin } from "@/server/exposes/urls";
import { touchpointUrls } from "@/server/tracking/touchpoints";

/**
 * POST /api/v1/exposes: publish a new version (§7.2). Used by
 * `pnpm expose:publish`; authenticated with a workspace API token. Assets
 * must be uploaded first via /api/v1/assets.
 */
export async function POST(request: Request) {
  const api = await authenticateApiRequest(request);
  if (!api) return apiError(401, "invalid_token");
  if (!can(api.actor, "exposes.publish", { workspaceId: api.actor.workspaceId })) {
    return apiError(403, "forbidden");
  }
  const text = await readTextLimited(request, 2 * 1024 * 1024);
  if (text === null) return apiError(413, "payload_too_large");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Reported as invalid_request below.
  }
  const parsed = publishRequestSchema.safeParse(json);
  if (!parsed.success) {
    return apiError(400, "invalid_request", [
      { path: "(Anfrage)", message: "JSON mit document und assets erwartet." },
    ]);
  }

  try {
    const result = await api.tenant(async (tx) => {
      const published = await publishExpose(
        tx,
        {
          workspaceId: api.actor.workspaceId,
          userId: api.actor.userId,
          apiTokenId: api.tokenId,
          source: "api",
        },
        { document: parsed.data.document, assets: parsed.data.assets },
      );
      const [workspace] = await tx
        .select({ id: workspaces.id, slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, api.actor.workspaceId));
      if (!workspace) throw new Error("workspace not visible");
      return { published, origin: await workspacePublicOrigin(tx, workspace) };
    });
    const body: PublishResponse = {
      exposeId: result.published.exposeId,
      version: result.published.version,
      url: `${result.origin}${exposePath(result.published.slug)}`,
      previewUrl: `${serverEnv().APP_URL}/exposes/${result.published.exposeId}`,
      refCode: result.published.refCode,
      createdExpose: result.published.createdExpose,
      ...touchpointUrls(result.origin, result.published.letter),
    };
    return Response.json(body, {
      status: result.published.createdExpose ? 201 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof PublishError) {
      return apiError(error.status, "invalid_expose", error.issues);
    }
    throw error;
  }
}
