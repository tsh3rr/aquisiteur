import { Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { can } from "@/domain/authz";
import type { LetterStatus } from "@/domain/letters/lifecycle";
import { listCampaigns } from "@/server/campaigns";
import { listLetters } from "@/server/letters/manage";
import { requireCockpit } from "@/server/session";
import { LetterTable } from "./table";

export const metadata: Metadata = { title: "Briefe" };

const FILTERS: Record<string, { label: string; statuses?: LetterStatus[] }> = {
  offen: { label: "Noch nicht versendet", statuses: ["draft", "queued", "submitted", "printed"] },
  versendet: { label: "Versendet", statuses: ["posted", "returned"] },
  alle: { label: "Alle" },
};

export default async function LettersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    kampagne?: string;
    neu?: string;
    uebersprungen?: string;
  }>;
}) {
  const { workspace, actor, tenant } = await requireCockpit();
  const params = await searchParams;
  const filter = FILTERS[params.status ?? ""] ? params.status! : "alle";
  const campaign = /^[0-9a-f-]{36}$/.test(params.kampagne ?? "") ? params.kampagne : undefined;
  const fresh = (params.neu ?? "").split(",").filter((id) => /^[0-9a-f-]{36}$/.test(id));
  const { rows, campaigns } = await tenant(async (tx) => ({
    rows: await listLetters(tx, workspace.id, {
      statuses: FILTERS[filter]!.statuses,
      campaignId: campaign,
    }),
    campaigns: await listCampaigns(tx, workspace.id, { includeArchived: true }),
  }));
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });
  const skipped = Number(params.uebersprungen ?? 0);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Briefe"
        description="Drucken Sie die Briefe aus dem PDF und markieren Sie sie als versendet. Ab dem Versanddatum misst Aquisiteur die Zeit bis zur Öffnung."
      />
      {fresh.length > 0 ? (
        <Alert tone="success">
          {fresh.length} {fresh.length === 1 ? "Brief" : "Briefe"} erstellt und unten ausgewählt.
          {skipped > 0 ? ` ${skipped} Kunden übersprungen.` : ""} Laden Sie das PDF herunter und
          prüfen Sie es vor dem Druck.
        </Alert>
      ) : null}
      <form
        method="get"
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Briefe filtern"
      >
        <Field label="Status">
          <Select name="status" defaultValue={filter}>
            {Object.entries(FILTERS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kampagne">
          <Select name="kampagne" defaultValue={campaign ?? ""}>
            <option value="">Alle</option>
            {campaigns.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary">
          Anwenden
        </Button>
      </form>
      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="grid justify-items-center gap-3 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
              <Mail aria-hidden className="size-5" />
            </span>
            <p className="font-medium">Keine Briefe in dieser Ansicht.</p>
            <p className="max-w-md text-sm text-foreground-muted">
              Wählen Sie in der{" "}
              <Link href="/kunden" className="text-accent underline underline-offset-4">
                Kundenliste
              </Link>{" "}
              Kunden aus und klicken Sie auf „Briefe erstellen“.
            </p>
          </CardContent>
        </Card>
      ) : (
        <LetterTable
          canManage={canManage}
          preselected={fresh}
          campaigns={Object.fromEntries(campaigns.map((option) => [option.id, option.name]))}
          rows={rows.map((row) => ({
            ...row,
            postedAt: row.postedAt?.toISOString() ?? null,
            openedAt: row.openedAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
          }))}
        />
      )}
    </div>
  );
}
