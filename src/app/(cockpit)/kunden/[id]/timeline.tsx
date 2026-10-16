import { Bot, Eye, FileText, Flag, Link2, Mail } from "lucide-react";
import type { TimelineEntry, TimelineKind } from "@/domain/tracking/timeline";
import { cn } from "@/lib/cn";

const ICONS: Record<TimelineKind, typeof Eye> = {
  visit: Eye,
  status: Flag,
  expose: FileText,
  touchpoint: Link2,
  letter: Mail,
};

const dayFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Berlin",
});
const timeFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

/** The readable history of a prospect (§7.8), grouped by day, newest first. */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">
        Noch nichts passiert. Sobald jemand den QR-Code scannt oder den Kurzlink abtippt, erscheint
        es hier.
      </p>
    );
  }
  const days = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const day = dayFormat.format(entry.at);
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return (
    <div className="grid gap-6">
      {[...days].map(([day, list]) => (
        <section key={day} aria-label={day} className="grid gap-3">
          <h3 className="text-sm font-medium text-foreground-muted">{day}</h3>
          <ol className="grid gap-3 border-l border-border pl-5">
            {list.map((entry) => {
              const Icon = entry.bot ? Bot : ICONS[entry.kind];
              return (
                <li
                  key={entry.key}
                  className={cn("relative grid gap-1", entry.muted && "text-foreground-muted")}
                >
                  <span
                    aria-hidden
                    className="absolute top-0.5 -left-[1.95rem] grid size-6 place-items-center rounded-full border border-border bg-surface"
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <time
                      dateTime={entry.at.toISOString()}
                      className="text-sm text-foreground-muted tabular-nums"
                    >
                      {timeFormat.format(entry.at)}
                    </time>
                    <span className="font-medium">{entry.title}</span>
                  </p>
                  {entry.detail ? (
                    <p className="text-sm text-foreground-muted">{entry.detail}</p>
                  ) : null}
                  {entry.steps.length > 0 ? (
                    <ul className="mt-1 grid gap-1 text-sm">
                      {entry.steps.map((step, index) => (
                        <li key={index} className="flex gap-2">
                          <time
                            dateTime={step.at.toISOString()}
                            className="shrink-0 text-foreground-muted tabular-nums"
                          >
                            {timeFormat.format(step.at)}
                          </time>
                          {step.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
