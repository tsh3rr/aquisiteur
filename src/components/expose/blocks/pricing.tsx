"use client";

import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import type { BlockOf } from "@/domain/expose/schema";
import { clsx } from "clsx";
import { pricingTotals } from "@/domain/expose/pricing";

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const range = (from: number, to: number) =>
  from === to ? euro.format(from) : `${euro.format(from)} – ${euro.format(to)}`;

/** Interactive price frame (§7.2): toggle options, totals update live and are announced politely. */
export function PricingCalculator({ block }: { block: BlockOf<"pricing"> }) {
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        block.options
          .filter((option) => option.selected || option.required)
          .map((option) => option.id),
      ),
  );
  const totals = useMemo(() => pricingTotals(block.options, selected), [block.options, selected]);

  return (
    <div className="grid gap-6">
      <fieldset className="grid gap-3">
        <legend className="sr-only">Leistungen auswählen</legend>
        {block.options.map((option) => {
          const checked = selected.has(option.id);
          return (
            <label
              key={option.id}
              className={clsx(
                "flex items-start gap-4 rounded-xl border bg-surface p-5 shadow-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring",
                checked ? "border-accent" : "border-border hover:border-border-strong",
                option.required ? "cursor-default" : "cursor-pointer",
              )}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={checked}
                disabled={option.required}
                data-pricing-option={option.id}
                data-option-title={option.title}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(option.id)) next.delete(option.id);
                    else next.add(option.id);
                    return next;
                  })
                }
              />
              <span
                aria-hidden
                className={clsx(
                  "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border-2",
                  checked
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border-strong",
                )}
              >
                {checked ? <Check className="size-4" strokeWidth={3} /> : null}
              </span>
              <span className="grid flex-1 gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-lg font-semibold">{option.title}</span>
                  <span className="font-semibold tabular-nums">
                    {range(option.price, option.priceTo ?? option.price)}
                    {option.billing === "monthly" ? (
                      <span className="font-normal text-foreground-muted"> / Monat</span>
                    ) : null}
                  </span>
                </span>
                {option.description ? (
                  <span className="text-foreground-muted">{option.description}</span>
                ) : null}
                {option.required ? (
                  <span className="text-sm text-foreground-muted">Immer enthalten</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>
      <div
        className="grid gap-2 rounded-xl bg-surface-sunken p-5"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold">Einmalig</span>
          <span className="text-2xl font-semibold tabular-nums">
            {range(totals.once.from, totals.once.to)}
          </span>
        </div>
        {totals.monthly.to > 0 ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold">Monatlich</span>
            <span className="text-xl font-semibold tabular-nums">
              {range(totals.monthly.from, totals.monthly.to)}
            </span>
          </div>
        ) : null}
        <p className="text-sm text-foreground-muted">{block.vatNote}</p>
      </div>
    </div>
  );
}
