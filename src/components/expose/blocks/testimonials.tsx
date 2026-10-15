import type { BlockOf } from "@/domain/expose/schema";
import { Picture } from "../picture";
import { resolveImage, type RenderContext } from "../render-context";
import { Section } from "../section";

export function TestimonialsBlock({
  block,
  context,
}: {
  block: BlockOf<"testimonials">;
  context: RenderContext;
}) {
  return (
    <Section id={block.id} type="testimonials" title={block.title} wide>
      <ul className="grid gap-4 md:grid-cols-2">
        {block.items.map((item, index) => {
          const photo = resolveImage(item.photo, context);
          return (
            <li key={index}>
              <figure className="grid h-full content-between gap-6 rounded-xl border border-border bg-surface p-6 shadow-sm">
                <blockquote className="font-display text-2xl leading-snug text-pretty">
                  <p>„{item.quote}“</p>
                </blockquote>
                <figcaption className="flex items-center gap-3">
                  {photo ? (
                    <Picture
                      image={photo}
                      sizes="48px"
                      className="size-12 shrink-0"
                      sizing="size-full"
                      imgClassName="rounded-full object-cover"
                    />
                  ) : null}
                  <span className="grid leading-tight">
                    <span className="font-semibold">{item.author}</span>
                    <span className="text-sm text-foreground-muted">
                      {[item.role, item.company].filter(Boolean).join(", ")}
                    </span>
                  </span>
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
