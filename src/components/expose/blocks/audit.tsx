import type { BlockOf } from "@/domain/expose/schema";
import { cn } from "@/lib/cn";
import { Section } from "../section";

function rating(value: number) {
  if (value >= 80)
    return { label: "Gut", tone: "text-success-foreground", stroke: "var(--aq-success)" };
  if (value >= 50)
    return { label: "Ausbaufähig", tone: "text-warning-foreground", stroke: "var(--aq-warning)" };
  return { label: "Schwach", tone: "text-danger", stroke: "var(--aq-danger)" };
}

/** Score tiles: value, verbal rating (never colour alone) and source (§7.2 "belegbar"). */
export function AuditBlock({ block }: { block: BlockOf<"audit"> }) {
  const circumference = 2 * Math.PI * 26;
  return (
    <Section id={block.id} type="audit" title={block.title} intro={block.intro} wide>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {block.scores.map((score) => {
          const r = rating(score.value);
          const value = Math.round(score.value);
          return (
            <li
              key={score.label}
              className="grid content-start gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm"
            >
              <div className="flex items-center gap-4">
                <svg viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90" aria-hidden>
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    fill="none"
                    stroke="var(--aq-border)"
                    strokeWidth="7"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    fill="none"
                    stroke={r.stroke}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={`${(circumference * value) / 100} ${circumference}`}
                  />
                </svg>
                <div className="grid">
                  <span className="text-3xl font-semibold tabular-nums">
                    {value}
                    <span className="text-base font-normal text-foreground-muted"> / 100</span>
                  </span>
                  <span className={cn("text-sm font-semibold", r.tone)}>{r.label}</span>
                </div>
              </div>
              <div className="grid gap-1">
                <h3 className="font-semibold">{score.label}</h3>
                {score.detail ? <p className="text-foreground-muted">{score.detail}</p> : null}
              </div>
              <p className="text-xs text-foreground-muted">Quelle: {score.source}</p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
