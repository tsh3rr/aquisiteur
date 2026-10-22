import { getDb } from "@/db";
import { getInfra } from "@/infra";
import { loadPublicInvoice } from "@/server/invoices/send";
import { workspaceForHostParam } from "@/server/sites";

export const dynamic = "force-dynamic";

/** The PDF that was mailed with the invoice (§7.10, 7c-2), never re-rendered. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ host: string; token: string }> },
) {
  const { host, token } = await params;
  const workspace = await workspaceForHostParam(host);
  const invoice = workspace ? await loadPublicInvoice(getDb(), workspace.id, token) : null;
  if (!invoice?.pdfKey) return new Response("Not found", { status: 404 });
  const file = await getInfra().storage.get(invoice.pdfKey);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.body, {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(file.size),
      "content-disposition": `attachment; filename="${invoice.number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
