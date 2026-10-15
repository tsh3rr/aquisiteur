import { List } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { can } from "@/domain/authz";
import { parseListQuery } from "@/domain/prospects/list-query";
import { listProspects } from "@/server/prospects/list";
import { requireCockpit } from "@/server/session";
import { Pipeline } from "./pipeline";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const { workspace, actor, tenant } = await requireCockpit();
  const rows = await tenant((tx) =>
    listProspects(tx, workspace.id, parseListQuery({ sort: "activity" })),
  );
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Pipeline"
        description="Ziehen Sie Karten in eine andere Spalte oder wählen Sie den Status auf der Karte."
        actions={
          <Link
            href="/kunden"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium shadow-sm hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <List aria-hidden className="size-4" />
            Liste
          </Link>
        }
      />
      <Pipeline
        canManage={can(actor, "prospects.manage", { workspaceId: workspace.id })}
        cards={rows.map((row) => ({
          id: row.id,
          companyName: row.companyName,
          city: row.city,
          status: row.status,
          lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
