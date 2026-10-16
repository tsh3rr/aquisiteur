import "server-only";
import { cookies } from "next/headers";
import { workspaceForHostParam } from "@/server/sites";
import { OWNER_COOKIE, isOwnerDevice } from "./visits";

/** Same-origin check for public POSTs: a foreign Origin header is refused. */
export function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || origin === "null") return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** JSON body of at most `maxBytes`, whatever the content type (sendBeacon sends text). */
export async function readJson(request: Request, maxBytes = 32 * 1024): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function ownerDeviceFor(workspaceId: string): Promise<boolean> {
  return isOwnerDevice((await cookies()).get(OWNER_COOKIE)?.value, workspaceId);
}

export const noStore = { "cache-control": "no-store" } as const;

/**
 * Shared frame of the exposé's POST routes: same-site only, workspace from
 * the host, JSON body. The handler gets the workspace id and the body.
 */
export async function publicPost(
  request: Request,
  params: Promise<{ host: string }>,
  handler: (workspaceId: string, body: unknown) => Promise<Response>,
): Promise<Response> {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const workspace = await workspaceForHostParam((await params).host);
  if (!workspace) return new Response("Not found", { status: 404 });
  return handler(workspace.id, await readJson(request));
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore });
}

export function empty(status: number): Response {
  return new Response(null, { status, headers: noStore });
}
