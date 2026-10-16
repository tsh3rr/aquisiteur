import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { assertCan } from "@/domain/authz";
import { IMPORT_FIELD_LABELS, IMPORT_FIELDS, MAX_IMPORT_ROWS } from "@/domain/prospects/import";
import { listCampaigns } from "@/server/campaigns";
import { requireCockpit } from "@/server/session";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Kunden importieren" };

export default async function ImportPage() {
  const { actor, workspace, tenant } = await requireCockpit();
  assertCan(actor, "prospects.manage", { workspaceId: workspace.id });
  const campaigns = await tenant((tx) => listCampaigns(tx, workspace.id));
  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader
        title="Kunden importieren"
        description={`Eine CSV-Datei aus Excel, Numbers oder Google Tabellen, bis ${MAX_IMPORT_ROWS} Zeilen. Pflicht ist nur die Spalte „Firma“.`}
      />
      <ImportForm
        campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
        fields={IMPORT_FIELDS.map((field) => IMPORT_FIELD_LABELS[field])}
      />
    </div>
  );
}
