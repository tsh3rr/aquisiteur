import { serverEnv } from "@/config/env";
import { workspaceForHostParam } from "@/server/sites";
import { OWNER_COOKIE, OWNER_COOKIE_TTL, ownerCookieFromLink } from "@/server/tracking/visits";

/**
 * Marks this browser as the owner's own device for the workspace host
 * (§6.2 „Eigene Besuche ausschließen“). The cockpit links here with a
 * short-lived signed token; `?entfernen=1` removes the mark. This is the
 * only cookie a workspace host sets, and only for the owner.
 */
export async function GET(request: Request, { params }: { params: Promise<{ host: string }> }) {
  const workspace = await workspaceForHostParam((await params).host);
  if (!workspace) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const secure = serverEnv().APP_URL.startsWith("https:") ? "; Secure" : "";
  const base = `${OWNER_COOKIE}=%VALUE%; Path=/; HttpOnly; SameSite=Lax${secure}`;
  const respond = (state: string, cookie?: string) =>
    new Response(null, {
      status: 303,
      headers: {
        location: `/?geraet=${state}`,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        ...(cookie ? { "set-cookie": cookie } : {}),
      },
    });

  if (url.searchParams.get("entfernen") === "1") {
    return respond("entfernt", `${base.replace("%VALUE%", "")}; Max-Age=0`);
  }
  const value = await ownerCookieFromLink(url.searchParams.get("token") ?? "", workspace.id);
  if (!value) return respond("ungueltig");
  return respond("markiert", `${base.replace("%VALUE%", value)}; Max-Age=${OWNER_COOKIE_TTL}`);
}
