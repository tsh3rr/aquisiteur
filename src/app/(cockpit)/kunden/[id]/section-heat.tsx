import { formatSeconds } from "@/domain/analytics/format";
import type { SectionHeat } from "@/domain/tracking/section-heat";

/**
 * Section heatmap (§7.8) as a list: each row names the section, its reading
 * time and readers in text; the bar only supports the number.
 */
export function SectionHeatList({ sections }: { sections: SectionHeat[] }) {
  const max = Math.max(1, ...sections.map((section) => section.seconds));
  return (
    <ol className="grid gap-2.5">
      {sections.map((section) => (
        <li key={section.blockId} className="grid gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-medium">{section.name}</span>
            <span className="text-foreground-muted tabular-nums">
              {section.seconds > 0
                ? `${formatSeconds(section.seconds)} · ${section.visits} ${section.visits === 1 ? "Besuch" : "Besuche"}`
                : "nicht gelesen"}
            </span>
          </div>
          <div aria-hidden className="h-2 rounded-sm bg-surface-sunken">
            <div
              className="h-2 rounded-sm bg-accent"
              style={{ width: `${(section.seconds / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
