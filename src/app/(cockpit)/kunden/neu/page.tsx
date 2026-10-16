import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { assertCan } from "@/domain/authz";
import { listCampaigns } from "@/server/campaigns";
import { requireCockpit } from "@/server/session";
import { createProspectAction } from "../actions";
import { EMPTY_PROSPECT, ProspectForm } from "../prospect-form";

export const metadata: Metadata = { title: "Neuer Kunde" };

export default async function NewCustomerPage() {
  const { actor, workspace, tenant } = await requireCockpit();
  assertCan(actor, "prospects.manage", { workspaceId: workspace.id });
  const campaigns = await tenant((tx) => listCampaigns(tx, workspace.id));
  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader
        title="Neuer Kunde"
        description="Für das Exposé tragen Sie danach den Schlüssel von der Kundenseite als prospect.key in die expose.json ein."
      />
      <Card>
        <CardContent>
          <ProspectForm
            action={createProspectAction}
            values={EMPTY_PROSPECT}
            campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
            submitLabel="Kunde anlegen"
          />
        </CardContent>
      </Card>
    </div>
  );
}
