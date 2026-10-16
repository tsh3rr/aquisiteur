import type { BlockOf } from "@/domain/expose/schema";
import { Section } from "../section";

export function RoadmapBlock({ block }: { block: BlockOf<"roadmap"> }) {
  return (
    <Section id={block.id} type="roadmap" title={block.title} intro={block.intro}>
      <ol className="relative grid gap-8 border-l-2 border-border pl-8">
        {block.steps.map((step, index) => (
          <li key={index} className="relative grid gap-1.5">
            <span
              aria-hidden
              className="absolute top-0 -left-[2.95rem] grid size-9 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground ring-4 ring-background"
            >
              {index + 1}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-xl font-semibold">
                <span className="sr-only">Schritt {index + 1}: </span>
                {step.title}
              </h3>
              {step.duration ? (
                <span className="text-sm text-foreground-muted">{step.duration}</span>
              ) : null}
            </div>
            <p className="text-foreground-muted">{step.description}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
