import type { BlockOf } from "@/domain/expose/schema";
import { OwnerBadge } from "../owner";
import { Picture } from "../picture";
import { resolveImage, type RenderContext } from "../render-context";

export function HeroBlock({ block, context }: { block: BlockOf<"hero">; context: RenderContext }) {
  const image = resolveImage(block.image, context);
  return (
    <section
      id={block.id}
      data-block="hero"
      aria-labelledby={`${block.id}-title`}
      className="relative overflow-hidden px-5 pt-10 pb-14 sm:px-8 sm:pt-16 sm:pb-20"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[32rem] bg-[radial-gradient(60%_60%_at_50%_40%,var(--aq-accent-soft),transparent)]"
      />
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div className="grid gap-6">
          {block.eyebrow ? (
            <p className="text-sm font-semibold tracking-wide text-accent uppercase">
              {block.eyebrow}
            </p>
          ) : null}
          <div className="grid gap-3">
            <p className="text-xl text-foreground-muted">{block.greeting}</p>
            <h1
              id={`${block.id}-title`}
              className="font-display text-4xl leading-[1.05] text-balance sm:text-5xl lg:text-6xl"
            >
              {block.headline}
            </h1>
          </div>
          {block.lead ? (
            <p className="max-w-prose text-lg text-pretty text-foreground-muted sm:text-xl">
              {block.lead}
            </p>
          ) : null}
          {block.showOwnerPhoto ? <OwnerBadge context={context} /> : null}
        </div>
        {image ? (
          <Picture
            image={image}
            priority
            sizes="(min-width: 1024px) 540px, 100vw"
            imgClassName="rounded-xl shadow-lg ring-1 ring-border"
          />
        ) : null}
      </div>
    </section>
  );
}
