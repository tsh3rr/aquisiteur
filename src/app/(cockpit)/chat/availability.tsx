"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { setAvailability } from "./actions";

type Availability = "auto" | "available" | "away";

const options: { value: Availability; label: string; hint: string }[] = [
  { value: "auto", label: "Automatisch", hint: "Verfügbar, solange ein Cockpit-Tab offen ist" },
  { value: "available", label: "Verfügbar", hint: "Auch wenn das Cockpit geschlossen ist" },
  { value: "away", label: "Abwesend", hint: "Exposés zeigen nicht „Verfügbar“" },
];

/** „Verfügbar“-Status for exposés (§7.4), as a radio group. */
export function AvailabilityControl({
  initial,
  available,
}: {
  initial: Availability;
  available: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2 sm:grid-cols-3" disabled={pending}>
        <legend className="sr-only">Verfügbarkeit</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "grid min-h-11 cursor-pointer gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring",
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <input
                type="radio"
                name="availability"
                value={option.value}
                checked={value === option.value}
                onChange={() => {
                  setValue(option.value);
                  startTransition(() => setAvailability(option.value));
                }}
                className="size-4 accent-accent"
              />
              {option.label}
            </span>
            <span className="text-foreground-muted">{option.hint}</span>
          </label>
        ))}
      </fieldset>
      <p className="flex items-center gap-2 text-sm" aria-live="polite">
        <span
          aria-hidden
          className={cn("size-2.5 rounded-full", available ? "bg-success" : "bg-foreground-muted")}
        />
        {available
          ? "Interessenten sehen Sie gerade als verfügbar."
          : "Interessenten sehen Sie gerade nicht als verfügbar."}
      </p>
    </div>
  );
}
