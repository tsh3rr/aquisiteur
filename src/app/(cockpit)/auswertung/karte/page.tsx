import type { Metadata } from "next";
import { FilterBar } from "@/components/analytics/filter-bar";
import { ProspectMap } from "@/components/analytics/prospect-map";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/domain/authz";
import { formatCount } from "@/domain/analytics/format";
import { loadMapData } from "@/server/analytics/map";
import { loadOptions, readDashboardParams, type SearchParams } from "@/server/analytics/params";
import { requireCockpit } from "@/server/session";
import { GeocodeNowButton } from "./geocode-button";

export const metadata: Metadata = { title: "Karte · Auswertung" };

export default async function MapPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspace, actor, tenant } = await requireCockpit();
  const { period, preset, filter } = readDashboardParams(await searchParams);
  const { data, options } = await tenant(async (tx) => ({
    data: await loadMapData(tx, workspace.id, filter),
    options: await loadOptions(tx, workspace.id),
  }));
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });
  const missing = [
    data.pending ? `${formatCount(data.pending)} warten auf die Ortssuche` : null,
    data.notFound ? `${formatCount(data.notFound)} Adressen nicht gefunden` : null,
    data.withoutAddress ? `${formatCount(data.withoutAddress)} ohne Ort oder PLZ` : null,
  ].filter(Boolean);

  return (
    <>
      <FilterBar period={period} preset={preset} filter={filter} options={options} />
      <Card>
        <CardHeader>
          <CardTitle>Kunden auf der Karte</CardTitle>
          <CardDescription>
            Aktueller Stand, unabhängig vom Zeitraum. Adressen werden einmal pro Stunde über
            OpenStreetMap verortet; geänderte Adressen kommen automatisch neu dran.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {missing.length > 0 ? (
            <Alert tone="info">
              {formatCount(data.points.length)} Kunden auf der Karte. Nicht dabei:{" "}
              {missing.join(", ")}.
            </Alert>
          ) : null}
          {canManage && data.pending > 0 ? <GeocodeNowButton /> : null}
          <ProspectMap points={data.points} />
        </CardContent>
      </Card>
    </>
  );
}
