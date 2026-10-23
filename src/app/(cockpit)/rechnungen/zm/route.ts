import { assertCan } from "@/domain/authz";
import { zmCsv, zmRows } from "@/domain/invoices/csv";
import { monthCsvRows } from "@/server/invoices/manage";
import { requireCockpit } from "@/server/session";

/** ZM data for a quarter (`?quartal=2026-4`): reverse-charge services per customer UID. */
export async function GET(request: Request) {
  const quarter = new URL(request.url).searchParams.get("quartal") ?? "";
  const match = /^(\d{4})-([1-4])$/.exec(quarter);
  if (!match) return new Response("Bad request", { status: 400 });
  const [year, index] = [match[1]!, Number(match[2])];
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "prospects.manage", { workspaceId: workspace.id });
  const months = [0, 1, 2].map(
    (offset) => `${year}-${String((index - 1) * 3 + 1 + offset).padStart(2, "0")}`,
  );
  const rows = await tenant(async (tx) => {
    const all = [];
    // One transaction runs one query at a time.
    for (const month of months) all.push(...(await monthCsvRows(tx, workspace.id, month)));
    return all;
  });
  return new Response(zmCsv(zmRows(rows)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="zm-${year}-q${index}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
