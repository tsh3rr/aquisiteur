"use client";

import { useState } from "react";
import { formatCount } from "@/domain/analytics/format";
import { ScrollRegion } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

export interface DailyPoint {
  day: string;
  visits: number;
  prospects: number;
}

const dayLabel = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const axisLabel = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "numeric",
  timeZone: "UTC",
});

function niceMax(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

/**
 * Real visits per day as thin bars with a hover/focus tooltip. The same
 * numbers are available as a table right below (§7.8, WCAG 1.1.1).
 */
export function DailyChart({ points, label }: { points: DailyPoint[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map((point) => point.visits)));
  const total = points.reduce((sum, point) => sum + point.visits, 0);
  const tickEvery = Math.ceil(points.length / 8);
  const current = active === null ? null : points[active];

  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions -- hover is a pointer extra; the table below carries every value */
  return (
    <figure className="grid gap-3">
      <div className="relative">
        <div
          role="img"
          aria-label={`${label}: ${formatCount(total)} Besuche an ${points.length} Tagen.`}
          className="relative h-40 border-b border-border"
          onMouseLeave={() => setActive(null)}
        >
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 border-t border-dashed border-border"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 top-1/2 border-t border-dashed border-border"
          />
          <div className="absolute inset-0 flex items-end">
            {points.map((point, index) => (
              // Each column is the hit area; the bar inside is the mark.
              <div
                key={point.day}
                className="flex h-full min-w-0 flex-1 items-end justify-center"
                onMouseEnter={() => setActive(index)}
              >
                {point.visits > 0 ? (
                  <div
                    className={cn(
                      "w-[70%] max-w-6 min-w-0.5 rounded-t-sm",
                      active === index ? "bg-accent-hover" : "bg-accent",
                    )}
                    style={{ height: `${(point.visits / max) * 100}%` }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div aria-hidden className="relative mt-1 h-4 text-[0.7rem] text-foreground-muted">
          {points.map((point, index) =>
            index % tickEvery === 0 ? (
              <span
                key={point.day}
                className="absolute -translate-x-1/2 tabular-nums"
                style={{ left: `${((index + 0.5) / points.length) * 100}%` }}
              >
                {axisLabel.format(new Date(`${point.day}T00:00:00Z`))}
              </span>
            ) : null,
          )}
        </div>
        <span
          className="absolute -top-5 right-0 text-xs text-foreground-muted tabular-nums"
          aria-hidden
        >
          max. {formatCount(max)}
        </span>
        {current ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-2 rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-md"
            style={{
              left: `${((active! + 0.5) / points.length) * 100}%`,
              transform: `translateX(${active! > points.length / 2 ? "calc(-100% - 8px)" : "8px"})`,
            }}
          >
            <p className="font-medium">{dayLabel.format(new Date(`${current.day}T00:00:00Z`))}</p>
            <p className="tabular-nums">
              {formatCount(current.visits)} Besuche · {formatCount(current.prospects)} Kunden
            </p>
          </div>
        ) : null}
      </div>
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent underline-offset-4 hover:underline">
          Werte als Tabelle
        </summary>
        <ScrollRegion label={`${label} als Tabelle`} className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1.5 font-medium">
                  Tag
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Besuche
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Kunden
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.day} className="border-b border-border last:border-0">
                  <td className="py-1.5">{dayLabel.format(new Date(`${point.day}T00:00:00Z`))}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCount(point.visits)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCount(point.prospects)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </details>
    </figure>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions */
}
