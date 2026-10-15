import { ArrowDown } from "lucide-react";
import type { BlockOf } from "@/domain/expose/schema";

export function CtaBlock({ block }: { block: BlockOf<"cta"> }) {
  return (
    <section
      id={block.id}
      data-block="cta"
      aria-labelledby={`${block.id}-title`}
      className="expose-reveal px-5 py-10 sm:px-8"
    >
      <div className="mx-auto grid max-w-3xl justify-items-start gap-4 rounded-2xl bg-accent-soft p-8 text-accent-soft-foreground sm:p-10">
        <h2 id={`${block.id}-title`} className="font-display text-3xl leading-tight text-balance">
          {block.headline}
        </h2>
        {block.text ? <p className="text-lg">{block.text}</p> : null}
        <a
          href={`#${block.target}`}
          data-cta
          className="mt-2 inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {block.label}
          <ArrowDown aria-hidden className="size-4" />
        </a>
      </div>
    </section>
  );
}
