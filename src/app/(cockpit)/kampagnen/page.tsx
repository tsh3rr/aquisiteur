import { Flag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { can } from "@/domain/authz";
import { formatCount } from "@/domain/analytics/format";
import { listCampaigns } from "@/server/campaigns";
import { requireCockpit } from "@/server/session";
import { createCampaignAction } from "./actions";
import { CampaignForm } from "./campaign-form";

export const metadata: Metadata = { title: "Kampagnen" };

export default async function CampaignsPage() {
  const { workspace, actor, tenant } = await requireCockpit();
  const campaigns = await tenant((tx) =>
    listCampaigns(tx, workspace.id, { includeArchived: true }),
  );
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Kampagnen"
        description="Fassen Sie Kunden zu Aussendungen zusammen, z. B. „Friseure Leipzig, Herbst“. Jede Kampagne hat ihre eigene Auswertung."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
        {campaigns.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="grid justify-items-center gap-3 py-14 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
                <Flag aria-hidden className="size-5" />
              </span>
              <p className="font-medium">Noch keine Kampagne.</p>
              <p className="max-w-md text-sm text-foreground-muted">
                Legen Sie rechts eine an und ordnen Sie Kunden beim Import oder in der Kundenliste
                zu.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-3" aria-label="Kampagnen">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  href={`/kampagnen/${campaign.id}`}
                  className="grid gap-1 rounded-lg border border-border bg-surface p-4 shadow-sm hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {campaign.name}
                    {campaign.archivedAt ? <Badge>Archiviert</Badge> : null}
                  </span>
                  <span className="text-sm text-foreground-muted">
                    {formatCount(campaign.prospects)}{" "}
                    {campaign.prospects === 1 ? "Kunde" : "Kunden"}
                    {campaign.description ? ` · ${campaign.description}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Neue Kampagne</CardTitle>
              <CardDescription>Nur ein Name ist Pflicht.</CardDescription>
            </CardHeader>
            <CardContent>
              <CampaignForm action={createCampaignAction} submitLabel="Kampagne anlegen" />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
