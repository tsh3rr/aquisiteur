import { Download, KanbanSquare, Plus, Upload, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { can } from "@/domain/authz";
import {
  BUILT_IN_VIEWS,
  canonicalViewQuery,
  parseListQuery,
  serializeListQuery,
} from "@/domain/prospects/list-query";
import { listCampaigns } from "@/server/campaigns";
import { LIST_LIMIT, listProspects, listSavedViews, listTags } from "@/server/prospects/list";
import { requireCockpit } from "@/server/session";
import { CustomerFilters } from "./filters";
import { CustomerTable } from "./table";
import { SavedViews } from "./views";

export const metadata: Metadata = { title: "Kunden" };

const linkButton =
  "inline-flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium shadow-sm hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, actor, tenant } = await requireCockpit();
  const query = parseListQuery(await searchParams);
  const current = serializeListQuery(query);
  const { rows, tags, views, campaigns } = await tenant(async (tx) => ({
    rows: await listProspects(tx, workspace.id, query),
    campaigns: await listCampaigns(tx, workspace.id),
    tags: await listTags(tx, workspace.id),
    views: await listSavedViews(tx, workspace.id, actor.userId),
  }));
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });
  const filtered = current !== "" && canonicalViewQuery(current) !== "";

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Kunden"
        description={
          rows.length >= LIST_LIMIT
            ? `Die ersten ${LIST_LIMIT} Treffer. Grenzen Sie die Liste mit Filtern ein.`
            : `${rows.length} ${rows.length === 1 ? "Kunde" : "Kunden"}${filtered ? " in dieser Ansicht" : ""}`
        }
        actions={
          <>
            <Link href="/kunden/pipeline" className={linkButton}>
              <KanbanSquare aria-hidden className="size-4" />
              Pipeline
            </Link>
            <a href={`/kunden/export${current ? `?${current}` : ""}`} className={linkButton}>
              <Download aria-hidden className="size-4" />
              CSV
            </a>
            {canManage ? (
              <Link href="/kunden/import" className={linkButton}>
                <Upload aria-hidden className="size-4" />
                Importieren
              </Link>
            ) : null}
            {canManage ? (
              <Link
                href="/kunden/neu"
                className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground shadow-sm hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <Plus aria-hidden className="size-4" />
                Neuer Kunde
              </Link>
            ) : null}
          </>
        }
      />

      <SavedViews
        current={current}
        builtIn={BUILT_IN_VIEWS}
        saved={views.map((view) => ({
          id: view.id,
          name: view.name,
          query: view.query,
          shared: !view.userId,
        }))}
        canManage={canManage}
      />
      <CustomerFilters
        query={query}
        tags={tags}
        campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
      />

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="grid justify-items-center gap-4 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
              <Users aria-hidden className="size-5" />
            </span>
            {filtered ? (
              <div className="grid max-w-md gap-1.5">
                <p className="font-medium">Keine Kunden in dieser Ansicht.</p>
                <p className="text-sm text-foreground-muted">
                  Lockern Sie die Filter oder{" "}
                  <Link href="/kunden" className="text-accent underline underline-offset-4">
                    zeigen Sie alle Kunden
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <div className="grid max-w-md gap-1.5">
                <p className="font-medium">Noch keine Kunden.</p>
                <p className="text-sm text-foreground-muted">
                  Kunden entstehen, wenn Sie ein Exposé veröffentlichen. Sie können auch eine Liste
                  als CSV importieren oder einzelne Kunden von Hand anlegen.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <CustomerTable
          columns={query.columns}
          canManage={canManage}
          campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
          rows={rows.map((row) => ({
            id: row.id,
            companyName: row.companyName,
            city: row.city,
            status: row.status,
            tags: row.tags,
            createdAt: row.createdAt.toISOString(),
            lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
            visitCount: row.visitCount,
            score: row.score,
            level: row.level,
            campaignId: row.campaignId,
            campaignName: row.campaignName,
          }))}
        />
      )}
    </div>
  );
}
