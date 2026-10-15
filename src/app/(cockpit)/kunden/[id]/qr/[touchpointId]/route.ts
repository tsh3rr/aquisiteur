import { and, eq } from "drizzle-orm";
import { touchpoints, workspaces } from "@/db/schema";
import { qrSvg } from "@/domain/tracking/qr";
import { workspacePublicOrigin } from "@/server/exposes/urls";
import { requireCockpit } from "@/server/session";

/** QR code of a touchpoint as SVG (§6.2); `?rahmen=1` adds frame and call to action. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; touchpointId: string }> },
) {
  const { id, touchpointId } = await params;
  const { workspace, tenant } = await requireCockpit();
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(touchpointId)) {
    return new Response("Not found", { status: 404 });
  }
  const found = await tenant(async (tx) => {
    const [link] = await tx
      .select({ qrToken: touchpoints.qrToken, shortCode: touchpoints.shortCode })
      .from(touchpoints)
      .where(
        and(
          eq(touchpoints.workspaceId, workspace.id),
          eq(touchpoints.prospectId, id),
          eq(touchpoints.id, touchpointId),
        ),
      );
    const [ws] = await tx
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id));
    return link && ws ? { link, origin: await workspacePublicOrigin(tx, ws) } : null;
  });
  if (!found) return new Response("Not found", { status: 404 });
  const framed = new URL(request.url).searchParams.get("rahmen") === "1";
  const host = new URL(found.origin).host;
  const svg = qrSvg({
    url: `${found.origin}/${found.link.qrToken}`,
    framed,
    caption: found.link.shortCode ? `${host}/${found.link.shortCode}` : null,
  });
  const name = `qr-${found.link.shortCode ?? found.link.qrToken}${framed ? "-rahmen" : ""}.svg`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
