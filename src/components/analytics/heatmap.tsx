import { formatCount, WEEKDAY_NAMES, WEEKDAYS } from "@/domain/analytics/format";
import { ScrollRegion } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

/** One hue, light to dark (sequential); 0 stays empty. */
const STEPS = ["bg-accent/15", "bg-accent/35", "bg-accent/60", "bg-accent/80", "bg-accent"];

function step(value: number, max: number) {
  if (value === 0 || max === 0) return null;
  return STEPS[Math.min(STEPS.length - 1, Math.floor((value / max) * STEPS.length))]!;
}

/**
 * Visits by weekday × hour (§7.8 „wann lesen Kunden“). A real table: every
 * cell holds its number for screen readers and as a tooltip.
 */
export function Heatmap({ data, caption }: { data: number[][]; caption: string }) {
  const max = Math.max(0, ...data.flat());
  const best = bestSlot(data);
  return (
    <div className="grid gap-3">
      <ScrollRegion label={caption}>
        <table className="w-full min-w-[40rem] border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-8">
                <span className="sr-only">Wochentag</span>
              </th>
              {Array.from({ length: 24 }, (_, hour) => (
                <th
                  key={hour}
                  scope="col"
                  className="font-normal text-foreground-muted tabular-nums"
                >
                  <span aria-hidden>{hour % 3 === 0 ? hour : ""}</span>
                  <span className="sr-only">{hour} Uhr</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((hours, day) => (
              <tr key={day}>
                <th scope="row" className="pr-1 text-left font-normal text-foreground-muted">
                  <abbr title={WEEKDAY_NAMES[day]} className="no-underline">
                    {WEEKDAYS[day]}
                  </abbr>
                </th>
                {hours.map((value, hour) => (
                  <td
                    key={hour}
                    title={`${WEEKDAY_NAMES[day]}, ${hour}–${hour + 1} Uhr: ${formatCount(value)} Besuche`}
                    className={cn("h-6 rounded-sm", step(value, max) ?? "bg-surface-sunken")}
                  >
                    <span className="sr-only">{formatCount(value)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-foreground-muted">
        <p>
          {best
            ? `Am meisten gelesen: ${WEEKDAY_NAMES[best.day]}, ${best.hour}–${best.hour + 1} Uhr.`
            : "Noch keine Besuche im Zeitraum."}
        </p>
        <div className="flex items-center gap-1" aria-hidden>
          <span>weniger</span>
          <span className="size-3 rounded-sm bg-surface-sunken" />
          {STEPS.map((className) => (
            <span key={className} className={cn("size-3 rounded-sm", className)} />
          ))}
          <span>mehr</span>
        </div>
      </div>
    </div>
  );
}

export function bestSlot(data: number[][]): { day: number; hour: number } | null {
  let best: { day: number; hour: number; value: number } | null = null;
  data.forEach((hours, day) =>
    hours.forEach((value, hour) => {
      if (value > 0 && (!best || value > best.value)) best = { day, hour, value };
    }),
  );
  return best;
}
