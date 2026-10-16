import type { BlockOf } from "@/domain/expose/schema";
import { ownerName } from "../owner";
import { Picture } from "../picture";
import { ownerPhoto, resolveImage, type RenderContext } from "../render-context";
import { RichText } from "../rich-text";
import { Section } from "../section";

export function AboutBlock({
  block,
  context,
}: {
  block: BlockOf<"about">;
  context: RenderContext;
}) {
  const image =
    resolveImage(block.image, context) ?? ownerPhoto(context, `Foto von ${ownerName(context)}`);
  return (
    <Section id={block.id} type="about" title={block.title} wide>
      <div className="grid items-start gap-10 md:grid-cols-[minmax(0,20rem)_1fr]">
        {image ? (
          <Picture
            image={image}
            sizes="(min-width: 768px) 320px, 100vw"
            imgClassName="rounded-xl object-cover shadow-md"
          />
        ) : null}
        <div className="grid gap-8">
          <RichText source={block.body} className="text-lg leading-relaxed" />
          {block.facts.length > 0 ? (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {block.facts.map((fact) => (
                <div key={fact.label} className="grid gap-0.5 rounded-lg bg-surface-sunken p-4">
                  <dt className="text-sm text-foreground-muted">{fact.label}</dt>
                  <dd className="text-xl font-semibold">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
