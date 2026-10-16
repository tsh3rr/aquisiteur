import { assertCan } from "@/domain/authz";
import { slugify } from "@/domain/slug";
import { exportProspect } from "@/server/data-export";
import { requireCockpit } from "@/server/session";

/** „Daten exportieren“ on the customer page (§9 Betroffenenrechte), as JSON. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "prospects.manage", { workspaceId: workspace.id });
  const data = await tenant((tx) => exportProspect(tx, workspace.id, id));
  if (!data) return new Response("Not found", { status: 404 });
  const company = String(data.tables.prospects?.[0]?.companyName ?? "kunde");
  const name = `${slugify(company) || "kunde"}-daten-${data.exportedAt.slice(0, 10)}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}
