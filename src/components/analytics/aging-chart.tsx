import { AlertTriangle, CircleCheck, Clock } from "lucide-react";
import type { AgingBucket, AgingRow } from "@/domain/analytics/business";
import { formatCount, formatEuro } from "@/domain/analytics/format";
import { cn } from "@/lib/cn";

const BAR: Record<AgingBucket, string> = {
  current: "bg-border-strong",
  d30: "bg-warning",
  d60: "bg-danger",
  older: "bg-danger",
};

const ICON: Record<AgingBucket, typeof Clock> = {
  current: CircleCheck,
  d30: Clock,
  d60: AlertTriangle,
  older: AlertTriangle,
};

/**
 * Open items by age as horizontal bars (share of everything open). Each row
 * names its bucket with an icon and carries its amount as text, so the
 * colour is never the only signal and the list doubles as the table view.
 */
export function AgingChart({ rows, label }: { rows: AgingRow[]; label: string }) {
  const max = Math.max(1, ...rows.map((row) => row.openCents));
  return (
    <ol aria-label={label} className="grid gap-3">
      {rows.map((row) => {
        const Icon = ICON[row.bucket];
        const width = row.openCents > 0 ? Math.max((row.openCents / max) * 100, 1) : 0;
        return (
          <li key={row.bucket} className="grid gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="inline-flex items-center gap-2 font-medium">
                <Icon aria-hidden className="size-4 shrink-0 text-foreground-muted" />
                {row.label}
              </span>
              <span className="text-foreground-muted tabular-nums">
                <span className="font-medium text-foreground">{formatEuro(row.openCents)}</span>
                {" · "}
                {formatCount(row.count)} {row.count === 1 ? "Rechnung" : "Rechnungen"}
              </span>
            </div>
            <div aria-hidden className="h-3 rounded-sm bg-surface-sunken">
              <div
                className={cn(
                  "h-3 rounded-sm motion-safe:transition-[width] motion-safe:duration-300",
                  BAR[row.bucket],
                )}
                style={{ width: `${width}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
