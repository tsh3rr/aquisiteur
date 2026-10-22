import { assertCan } from "@/domain/authz";
import { invoicesCsv } from "@/domain/invoices/csv";
import { monthCsvRows } from "@/server/invoices/manage";
import { requireCockpit } from "@/server/session";

/** „CSV für Oktober 2026“ on the invoice list: the month for the tax adviser. */
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("monat") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Bad request", { status: 400 });
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "prospects.manage", { workspaceId: workspace.id });
  const rows = await tenant((tx) => monthCsvRows(tx, workspace.id, month));
  return new Response(invoicesCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="rechnungen-${month}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
