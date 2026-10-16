import { AlertTriangle, ArrowRight, Info, OctagonAlert } from "lucide-react";
import type { BlockOf } from "@/domain/expose/schema";
import { Section } from "../section";

const severity = {
  high: {
    label: "Wichtig",
    icon: OctagonAlert,
    className: "bg-danger-soft text-danger-soft-foreground",
  },
  medium: {
    label: "Mittel",
    icon: AlertTriangle,
    className: "bg-warning-soft text-warning-foreground",
  },
  low: { label: "Gering", icon: Info, className: "bg-accent-soft text-accent-soft-foreground" },
} as const;

export function FindingsBlock({ block }: { block: BlockOf<"findings"> }) {
  return (
    <Section id={block.id} type="findings" title={block.title} intro={block.intro}>
      <ol className="grid gap-4">
        {block.items.map((item, index) => {
          const s = severity[item.severity];
          return (
            <li
              key={index}
              className="grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-xl font-semibold text-balance">{item.title}</h3>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${s.className}`}
                >
                  <s.icon aria-hidden className="size-4" />
                  {s.label}
                </span>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1">
                  <dt className="text-sm font-semibold text-foreground-muted">Was es Sie kostet</dt>
                  <dd>{item.impact}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="flex items-center gap-1.5 text-sm font-semibold text-accent">
                    <ArrowRight aria-hidden className="size-4" />
                    Lösung
                  </dt>
                  <dd>{item.solution}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
