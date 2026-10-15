import { serverEnv } from "@/config/env";
import { getDb } from "@/db";
import { workspaceForHostParam } from "@/server/sites";
import { isCrossSite, noStore, readJson } from "@/server/tracking/http";
import { shareLinkForVisit } from "@/server/tracking/visits";

/** „Mit Kollegen teilen“ (§7.3): a link of its own, so forwarded reads are visible. */
export async function POST(request: Request, { params }: { params: Promise<{ host: string }> }) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const workspace = await workspaceForHostParam((await params).host);
  if (!workspace) return new Response("Not found", { status: 404 });
  const body = (await readJson(request)) as { token?: unknown } | null;
  const result = await shareLinkForVisit(getDb(), {
    workspaceId: workspace.id,
    token: body?.token,
  });
  if (result === "invalid") return new Response(null, { status: 400, headers: noStore });
  if (result === "limited") return new Response(null, { status: 429, headers: noStore });
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = new URL(serverEnv().APP_URL).protocol;
  return Response.json({ url: `${protocol}//${host}/${result.qrToken}` }, { headers: noStore });
}
