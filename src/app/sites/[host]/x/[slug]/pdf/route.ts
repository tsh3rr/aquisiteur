import { getDb } from "@/db";
import { loadPublicExpose } from "@/server/exposes/load";
import { printableExpose } from "@/server/exposes/print";
import { workspaceForHostParam } from "@/server/sites";

/**
 * Input of the designed exposé PDF for the reader's download (§7.9). Holds
 * nothing the page itself does not show; the browser renders the PDF and
 * adds the page's own address as link and QR code. An expired exposé shows
 * only its short page, so there is no PDF of the full version either.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ host: string; slug: string }> },
) {
  const { host, slug } = await params;
  const workspace = await workspaceForHostParam(host);
  const data = workspace ? await loadPublicExpose(getDb(), workspace.id, slug) : null;
  if (!data || data.expiry.expired) return new Response(null, { status: 404 });
  return Response.json(printableExpose(data, { assetBase: "/assets", url: null }), {
    headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
}
