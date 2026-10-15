import { getDb } from "@/db";
import { optOutByExposeSlug } from "@/server/exposes/opt-out";
import { workspaceForHostParam } from "@/server/sites";

/**
 * Confirms the opt-out (§7.3). A form POST with a 303 back to the page, so
 * the redirect passes the host routing like any request. Cross-site posts
 * are refused.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ host: string; slug: string }> },
) {
  const { host, slug } = await params;
  const origin = request.headers.get("origin");
  const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && origin !== "null" && new URL(origin).host !== requestHost) {
    return new Response("Forbidden", { status: 403 });
  }
  const workspace = await workspaceForHostParam(host);
  if (!workspace || !(await optOutByExposeSlug(getDb(), workspace.id, slug))) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(null, {
    status: 303,
    headers: { location: `/x/${encodeURIComponent(slug)}/kein-interesse?done=1` },
  });
}
