import { Mail, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilterBar } from "@/components/analytics/filter-bar";
import { OverviewSections } from "@/components/analytics/overview-sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, ScrollRegion } from "@/components/ui/misc";
import { can } from "@/domain/authz";
import { formatCount } from "@/domain/analytics/format";
import { parseListQuery } from "@/domain/prospects/list-query";
import { STATUS_LABELS, STATUS_TONES } from "@/domain/prospects/status";
import { loadOverview } from "@/server/analytics/dashboard";
import { loadOptions, readDashboardParams, type SearchParams } from "@/server/analytics/params";
import { getCampaign } from "@/server/campaigns";
import { listProspects } from "@/server/prospects/list";
import { requireCockpit } from "@/server/session";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { updateCampaignAction } from "../actions";
import { CampaignForm } from "../campaign-form";
import { DeleteCampaignButton } from "../delete-button";

export const metadata: Metadata = { title: "Kampagne" };

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { workspace, actor, tenant } = await requireCockpit();
  const dashboard = readDashboardParams(await searchParams);
  const filter = { ...dashboard.filter, campaignId: id };
  const result = await tenant(async (tx) => {
    const campaign = await getCampaign(tx, workspace.id, id);
    if (!campaign) return null;
    const settings = await loadWorkspaceSettings(tx, workspace.id);
    return {
      campaign,
      data: await loadOverview(
        tx,
        workspace.id,
        filter,
        dashboard.period,
        settings.notifications.timezone,
      ),
      options: await loadOptions(tx, workspace.id),
      prospects: await listProspects(
        tx,
        workspace.id,
        parseListQuery(new URLSearchParams({ kampagne: id })),
        500,
      ),
    };
  });
  if (!result) notFound();
  const { campaign, data, options, prospects } = result;
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });
  const exportQuery = new URLSearchParams(dashboard.query);
  exportQuery.set("kampagne", id);

  return (
    <div className="grid gap-6">
      <nav aria-label="Brotkrumen" className="text-sm">
        <Link href="/kampagnen" className="text-accent underline-offset-4 hover:underline">
          Kampagnen
        </Link>
      </nav>
      <PageHeader
        title={campaign.name}
        description={
          campaign.description ??
          `${formatCount(prospects.length)} Kunden · angelegt am ${dateFormat.format(campaign.createdAt)}`
        }
        actions={
          canManage && prospects.length > 0 ? (
            <Button asChild>
              <Link href={`/briefe/neu?kampagne=${id}`}>
                <Mail aria-hidden />
                Briefe für alle erstellen
              </Link>
            </Button>
          ) : undefined
        }
      />
      {campaign.archivedAt ? <Badge className="w-fit">Archiviert</Badge> : null}
      <FilterBar
        period={dashboard.period}
        preset={dashboard.preset}
        filter={filter}
        options={options}
        hideCampaign
        exportHref={`/auswertung/export?${exportQuery.toString()}`}
      />
      <OverviewSections data={data} compareCampaigns={false} />

      <Card>
        <CardHeader className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>Kunden der Kampagne</CardTitle>
            <CardDescription>
              {formatCount(prospects.length)} Kunden, aktueller Stand.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href={`/kunden?kampagne=${id}`}>
                <Users aria-hidden />
                In der Kundenliste
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={`/briefe?kampagne=${id}`}>
                <Mail aria-hidden />
                Briefe
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {prospects.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              Noch keine Kunden. Ordnen Sie Kunden in der{" "}
              <Link href="/kunden" className="text-accent underline underline-offset-4">
                Kundenliste
              </Link>{" "}
              oder beim{" "}
              <Link href="/kunden/import" className="text-accent underline underline-offset-4">
                Import
              </Link>{" "}
              zu.
            </p>
          ) : (
            <ScrollRegion label="Kunden der Kampagne">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Firma
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Status
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Ort
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Besuche
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Kontaktabsicht
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <th scope="row" className="py-2 pr-4 font-medium">
                        <Link
                          href={`/kunden/${row.id}`}
                          className="text-accent underline-offset-4 hover:underline"
                        >
                          {row.companyName}
                        </Link>
                      </th>
                      <td className="py-2 pr-4">
                        <Badge tone={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                      </td>
                      <td className="py-2 pr-4">{row.city ?? "–"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatCount(row.visitCount)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {row.score === null ? "–" : `${row.score} %`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Kampagne bearbeiten</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <CampaignForm
              action={updateCampaignAction.bind(null, id)}
              initial={{
                name: campaign.name,
                description: campaign.description,
                archived: campaign.archivedAt !== null,
              }}
              submitLabel="Speichern"
            />
            <DeleteCampaignButton id={id} name={campaign.name} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
