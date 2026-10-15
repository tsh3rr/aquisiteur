import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { assertCan } from "@/domain/authz";
import { requireCockpit } from "@/server/session";
import { createProspectAction } from "../actions";
import { EMPTY_PROSPECT, ProspectForm } from "../prospect-form";

export const metadata: Metadata = { title: "Neuer Kunde" };

export default async function NewCustomerPage() {
  const { actor, workspace } = await requireCockpit();
  assertCan(actor, "prospects.manage", { workspaceId: workspace.id });
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
            submitLabel="Kunde anlegen"
          />
        </CardContent>
      </Card>
    </div>
  );
}
