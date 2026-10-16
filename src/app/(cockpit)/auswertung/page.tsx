import type { Metadata } from "next";
import { FilterBar } from "@/components/analytics/filter-bar";
import { OverviewSections } from "@/components/analytics/overview-sections";
import { loadOverview } from "@/server/analytics/dashboard";
import { loadOptions, readDashboardParams, type SearchParams } from "@/server/analytics/params";
import { requireCockpit } from "@/server/session";
import { loadWorkspaceSettings } from "@/server/workspaces";

export const metadata: Metadata = { title: "Auswertung" };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { workspace, tenant } = await requireCockpit();
  const { period, preset, filter, query } = readDashboardParams(await searchParams);
  const { data, options } = await tenant(async (tx) => {
    const settings = await loadWorkspaceSettings(tx, workspace.id);
    return {
      data: await loadOverview(tx, workspace.id, filter, period, settings.notifications.timezone),
      options: await loadOptions(tx, workspace.id),
    };
  });
  return (
    <>
      <FilterBar
        period={period}
        preset={preset}
        filter={filter}
        options={options}
        exportHref={`/auswertung/export?${query}`}
      />
      <OverviewSections data={data} compareCampaigns={!filter.campaignId} />
    </>
  );
}
