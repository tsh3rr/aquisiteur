import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import {
  isoDay,
  lastDay,
  PRESET_LABELS,
  PRESETS,
  type Period,
  type Preset,
} from "@/domain/analytics/period";
import type { AnalyticsFilter } from "@/server/analytics/filters";

export interface FilterOptions {
  campaigns: { id: string; name: string }[];
  industries: string[];
  cities: string[];
  tags: string[];
}

/**
 * The one filter row above every dashboard (§7.8): period plus Kampagne,
 * Branche, Region, Tag. A plain GET form, so every view has a shareable URL.
 */
export function FilterBar({
  period,
  preset,
  filter,
  options,
  hideCampaign = false,
  exportHref,
}: {
  period: Period;
  preset: Preset | null;
  filter: AnalyticsFilter;
  options: FilterOptions;
  hideCampaign?: boolean;
  exportHref?: string;
}) {
  return (
    <form
      method="get"
      role="search"
      aria-label="Auswertung filtern"
      className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4 xl:flex xl:flex-wrap xl:items-end"
    >
      <Field label="Zeitraum">
        <Select name="zeitraum" defaultValue={preset ?? ""}>
          {(Object.keys(PRESETS) as Preset[]).map((key) => (
            <option key={key} value={key}>
              {PRESET_LABELS[key]}
            </option>
          ))}
          <option value="">Eigener Zeitraum</option>
        </Select>
      </Field>
      <Field label="Von" hint="Mit Bis: eigener Zeitraum">
        <Input
          type="date"
          name="von"
          defaultValue={preset ? "" : isoDay(period.from)}
          max={isoDay(new Date())}
        />
      </Field>
      <Field label="Bis">
        <Input
          type="date"
          name="bis"
          defaultValue={preset ? "" : lastDay(period)}
          max={isoDay(new Date())}
        />
      </Field>
      {hideCampaign ? null : (
        <Field label="Kampagne">
          <Select name="kampagne" defaultValue={filter.campaignId ?? ""}>
            <option value="">Alle</option>
            {options.campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Branche">
        <Select name="branche" defaultValue={filter.industry ?? ""}>
          <option value="">Alle</option>
          {options.industries.map((industry) => (
            <option key={industry} value={industry}>
              {industry}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Region" hint="Ort oder PLZ-Anfang">
        <Input
          name="region"
          defaultValue={filter.region ?? ""}
          list="analytics-cities"
          maxLength={100}
        />
      </Field>
      <datalist id="analytics-cities">
        {options.cities.map((city) => (
          <option key={city} value={city} />
        ))}
      </datalist>
      <Field label="Tag">
        <Select name="tag" defaultValue={filter.tag ?? ""}>
          <option value="">Alle</option>
          {options.tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-1">
        <Button type="submit" variant="secondary">
          Anwenden
        </Button>
        {exportHref ? (
          <Button asChild variant="ghost">
            <a href={exportHref} download>
              <Download aria-hidden />
              CSV
            </a>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
