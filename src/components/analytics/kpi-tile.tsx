import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Trend } from "@/domain/analytics/period";

/**
 * One headline number with its trend against the previous period. The
 * trend carries an arrow and words, never colour alone; `better` says which
 * direction is good (costs should fall).
 */
export function KpiTile({
  label,
  value,
  trend,
  better = "up",
  hint,
}: {
  label: string;
  value: string;
  trend?: Trend;
  better?: "up" | "down";
  hint?: string;
}) {
  const Icon =
    trend?.direction === "up"
      ? ArrowUpRight
      : trend?.direction === "down"
        ? ArrowDownRight
        : ArrowRight;
  const tone =
    !trend || trend.direction === "flat"
      ? "neutral"
      : trend.direction === better
        ? "success"
        : "danger";
  return (
    <div className="grid content-start gap-1.5 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <dt className="text-sm text-foreground-muted">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {trend ? (
        <dd>
          <Badge tone={tone}>
            <Icon aria-hidden />
            {trend.text}
          </Badge>
        </dd>
      ) : null}
      {hint ? <dd className="text-xs text-foreground-muted">{hint}</dd> : null}
    </div>
  );
}
