import { getDb } from "@/db";
import { RESERVED_CODES } from "@/domain/tracking/short-links";
import { robotsTxt } from "@/lib/robots";
import { workspaceForHostParam } from "@/server/sites";
import { ownerDeviceFor } from "@/server/tracking/http";
import { hitRateLimit } from "@/server/tracking/rate-limit";
import {
  clientKey,
  shortLinksBlocked,
  typedCodesBlocked,
} from "@/server/tracking/short-link-guard";
import { createVisit, resolveCode, ticketForVisit } from "@/server/tracking/visits";

const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

/**
 * Short-link resolver (§6.2): `<host>/<code>` records the visit and sends
 * the browser on to the exposé with a short-lived signed ticket, which the
 * exposé's script exchanges for its visit token. Unknown codes land on a
 * friendly „Meinten Sie …?“ page instead of a 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ host: string; code: string }> },
) {
  const { host, code: param } = await params;
  const workspace = await workspaceForHostParam(host);
  if (!workspace) return new Response("Not found", { status: 404 });

  let code: string;
  try {
    code = decodeURIComponent(param).slice(0, 80);
  } catch {
    code = "";
  }
  if (code === "robots.txt") {
    return new Response(robotsTxt(), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (RESERVED_CODES.has(code)) return new Response("Not found", { status: 404 });

  const db = getDb();
  // A client guessing codes gets nothing more until its window ends.
  if (await shortLinksBlocked(db, workspace.id, await clientKey(request.headers))) {
    return new Response(null, {
      status: 302,
      headers: { ...headers, location: "/nicht-gefunden?zuviele=1" },
    });
  }
  // Too many unknown codes in the whole workspace: only unguessable QR tokens resolve.
  const qrOnly = await typedCodesBlocked(db, workspace.id);
  const hit = code ? await resolveCode(db, workspace.id, code, { qrOnly }) : null;
  if (!hit && qrOnly) {
    return new Response(null, {
      status: 302,
      headers: { ...headers, location: "/nicht-gefunden?zuviele=1" },
    });
  }
  if (!hit) {
    return new Response(null, {
      status: 302,
      headers: { ...headers, location: `/nicht-gefunden?code=${encodeURIComponent(code)}` },
    });
  }

  let location = `/x/${hit.slug}`;
  // A flood of hits on one code (a scanner, a loop) stops being recorded, not served.
  if (await hitRateLimit(db, `r:${hit.touchpointId}`, 120, 600)) {
    const visit = await createVisit(db, {
      workspaceId: workspace.id,
      prospectId: hit.prospectId,
      exposeId: hit.exposeId,
      touchpointId: hit.touchpointId,
      source: hit.source,
      headers: request.headers,
      internal: await ownerDeviceFor(workspace.id),
      botReason: request.method === "HEAD" ? "Nur Kopfzeilen abgefragt (HEAD)" : undefined,
    });
    location += `?v=${encodeURIComponent(await ticketForVisit(visit.id))}`;
  }
  return new Response(null, { status: 302, headers: { ...headers, location } });
}
