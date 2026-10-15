import { and, eq, inArray } from "drizzle-orm";
import { prospects } from "@/db/schema";
import { toCsv } from "@/domain/csv";
import { parseListQuery } from "@/domain/prospects/list-query";
import { STATUS_LABELS } from "@/domain/prospects/status";
import { listProspects } from "@/server/prospects/list";
import { requireCockpit } from "@/server/session";

/** CSV of the current view, or of the selected customers (`?ids=`). */
export async function GET(request: Request) {
  const { workspace, tenant } = await requireCockpit();
  const params = new URL(request.url).searchParams;
  const ids = (params.get("ids") ?? "")
    .split(",")
    .filter((id) => /^[0-9a-f-]{36}$/.test(id))
    .slice(0, 500);
  const rows = await tenant(async (tx) => {
    const list = await listProspects(tx, workspace.id, parseListQuery(params), 5000);
    if (ids.length === 0) return list;
    const visible = await tx
      .select({ id: prospects.id })
      .from(prospects)
      .where(and(eq(prospects.workspaceId, workspace.id), inArray(prospects.id, ids)));
    const allowed = new Set(visible.map((row) => row.id));
    return list.filter((row) => allowed.has(row.id));
  });
  const csv = toCsv([
    [
      "Firma",
      "Status",
      "Ort",
      "E-Mail",
      "Telefon",
      "Website",
      "Tags",
      "Besuche",
      "Letzte Aktivität",
      "Angelegt",
    ],
    ...rows.map((row) => [
      row.companyName,
      STATUS_LABELS[row.status],
      row.city,
      row.email,
      row.phone,
      row.website,
      row.tags.join(", "),
      row.visitCount,
      row.lastActivityAt?.toISOString() ?? null,
      row.createdAt.toISOString(),
    ]),
  ]);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="kunden-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
