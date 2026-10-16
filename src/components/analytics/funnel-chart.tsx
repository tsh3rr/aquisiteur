import { formatCount, formatPercent } from "@/domain/analytics/format";
import type { FunnelRow } from "@/domain/analytics/funnel";

/**
 * Funnel as horizontal bars (share of "versendet"). The list itself carries
 * every number as text, so it doubles as the table view (§7.8).
 */
export function FunnelChart({ rows, label }: { rows: FunnelRow[]; label: string }) {
  const sent = rows[0]?.count ?? 0;
  return (
    <ol aria-label={label} className="grid gap-3">
      {rows.map((row) => {
        const width = sent > 0 ? Math.max((row.count / sent) * 100, row.count > 0 ? 1 : 0) : 0;
        return (
          <li key={row.stage} className="grid gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-medium">{row.label}</span>
              <span className="text-foreground-muted tabular-nums">
                <span className="font-medium text-foreground">{formatCount(row.count)}</span>
                {row.stage === "sent" ? null : <> · {formatPercent(row.rate)}</>}
                {row.dropOff !== null && row.dropOff > 0 ? (
                  <> · {formatPercent(row.dropOff)} abgesprungen</>
                ) : null}
              </span>
            </div>
            <div aria-hidden className="h-3 rounded-sm bg-surface-sunken">
              <div
                className="h-3 rounded-sm bg-accent motion-safe:transition-[width] motion-safe:duration-300"
                style={{ width: `${width}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
