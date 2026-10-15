import "server-only";
import { cookies } from "next/headers";
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
