"use client";

import { useEffect, useState } from "react";
import { niceMaxCents, type MonthRevenue } from "@/domain/analytics/business";
import { formatEuro } from "@/domain/analytics/format";
import { cn } from "@/lib/cn";

const monthShort = new Intl.DateTimeFormat("de-DE", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const asDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

const SERIES = [
  { key: "oneOffCents", label: "Projekte", swatch: "bg-chart-1" },
  { key: "recurringCents", label: "Wartung", swatch: "bg-chart-2" },
] as const;

/**
 * Net revenue per month as stacked bars (projects below, maintenance on
 * top) with a hover tooltip. A month whose cancellations outweigh it shows
 * no bar; the table below carries every value, negative ones included
 * (§7.8, WCAG 1.1.1).
 */
export function RevenueChart({ months, label }: { months: MonthRevenue[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const positive = (cents: number) => Math.max(0, cents);
  const max = niceMaxCents(
    Math.max(0, ...months.map((m) => positive(m.oneOffCents) + positive(m.recurringCents))),
  );
  const total = months.reduce((sum, m) => sum + m.oneOffCents + m.recurringCents, 0);
  const current = active === null ? null : months[active];

  // WCAG 1.4.13: the tooltip covers other bars, so Escape dismisses it.
  useEffect(() => {
    if (active === null) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [active]);

  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions -- hover is a pointer extra; the table below carries every value */
  return (
    <figure className="grid gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground-muted">
        {SERIES.map((series) => (
          <li key={series.key} className="inline-flex items-center gap-2">
            <span aria-hidden className={cn("size-3 rounded-sm", series.swatch)} />
            {series.label}
          </li>
        ))}
      </ul>
      <div className="relative mt-5">
        <div
          role="img"
          aria-label={`${label}: ${formatEuro(total, true)} netto in ${months.length} Monaten.`}
          className="relative h-48 border-b border-border"
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
            {months.map((month, index) => {
              const oneOff = positive(month.oneOffCents);
              const recurring = positive(month.recurringCents);
              return (
                // Each column is the hit area; the stacked bar inside is the mark.
                <div
                  key={month.month}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                  onMouseEnter={() => setActive(index)}
                >
                  {recurring > 0 ? (
                    <div
                      className={cn(
                        "w-[60%] max-w-10 rounded-t-[4px] bg-chart-2",
                        oneOff > 0 && "mb-0.5",
                        active === index && "opacity-80",
                      )}
                      style={{ height: `${(recurring / max) * 100}%` }}
                    />
                  ) : null}
                  {oneOff > 0 ? (
                    <div
                      className={cn(
                        "w-[60%] max-w-10 bg-chart-1",
                        recurring > 0 ? "rounded-none" : "rounded-t-[4px]",
                        active === index && "opacity-80",
                      )}
                      style={{ height: `${(oneOff / max) * 100}%` }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <div aria-hidden className="relative mt-1 h-4 text-[0.7rem] text-foreground-muted">
          {months.map((month, index) => (
            <span
              key={month.month}
              className={cn(
                "absolute -translate-x-1/2 tabular-nums",
                // Every other month on small screens keeps the labels apart.
                index % 2 === 1 && "max-sm:hidden",
              )}
              style={{ left: `${((index + 0.5) / months.length) * 100}%` }}
            >
              {monthShort.format(asDate(month.month))}
            </span>
          ))}
        </div>
        <span
          className="absolute -top-5 right-0 text-xs text-foreground-muted tabular-nums"
          aria-hidden
        >
          max. {formatEuro(max, true)}
        </span>
        {current ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-2 rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-md"
            style={{
              left: `${((active! + 0.5) / months.length) * 100}%`,
              transform: `translateX(${active! > months.length / 2 ? "calc(-100% - 8px)" : "8px"})`,
            }}
          >
            <p className="font-medium">{monthLong.format(asDate(current.month))}</p>
            {SERIES.map((series) => (
              <p key={series.key} className="flex items-center gap-2 tabular-nums">
                <span className={cn("size-2 rounded-sm", series.swatch)} />
                {series.label}: {formatEuro(current[series.key])}
              </p>
            ))}
            <p className="tabular-nums">
              Gesamt: {formatEuro(current.oneOffCents + current.recurringCents)}
            </p>
          </div>
        ) : null}
      </div>
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent underline-offset-4 hover:underline">
          Werte als Tabelle
        </summary>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1.5 font-medium">
                  Monat
                </th>
                {SERIES.map((series) => (
                  <th key={series.key} scope="col" className="py-1.5 text-right font-medium">
                    {series.label}
                  </th>
                ))}
                <th scope="col" className="py-1.5 text-right font-medium">
                  Gesamt
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((month) => (
                <tr key={month.month} className="border-b border-border last:border-0">
                  <td className="py-1.5">{monthLong.format(asDate(month.month))}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatEuro(month.oneOffCents)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatEuro(month.recurringCents)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatEuro(month.oneOffCents + month.recurringCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions */
}
