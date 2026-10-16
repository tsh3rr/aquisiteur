import { assertCan } from "@/domain/authz";
import { exportWorkspaceStream } from "@/server/data-export";
import { requireCockpit } from "@/server/session";

/** Settings → Daten: the whole workspace as one JSON file (§9a), owners only. */
export async function GET() {
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "workspace.export", { workspaceId: workspace.id });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(exportWorkspaceStream(tenant, workspace.id), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${workspace.slug}-export-${day}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
