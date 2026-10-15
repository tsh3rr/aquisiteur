import type { ExposeBlock } from "@/domain/expose/schema";
import { resolveImage, type RenderContext, type ResolvedImage } from "../render-context";
import { Section } from "../section";
import { AboutBlock } from "./about";
import { AuditBlock } from "./audit";
import { BeforeAfterSlider } from "./before-after";
import { BrandPreviewBlock } from "./brand-preview";
import { ContactBlock } from "./contact";
import { CtaBlock } from "./cta";
import { FaqBlock } from "./faq";
import { FindingsBlock } from "./findings";
import { MockupGallery } from "./gallery";
import { HeroBlock } from "./hero";
import { PersonalNoteBlock } from "./personal-note";
import { PricingCalculator } from "./pricing";
import { ProposalBlock } from "./proposal";
import { RoadmapBlock } from "./roadmap";
import { TestimonialsBlock } from "./testimonials";

/** Maps every block type of the schema to its renderer. Exhaustive by type. */
export function Block({ block, context }: { block: ExposeBlock; context: RenderContext }) {
  switch (block.type) {
    case "hero":
      return <HeroBlock block={block} context={context} />;
    case "personal_note":
      return <PersonalNoteBlock block={block} context={context} />;
    case "audit":
      return <AuditBlock block={block} />;
    case "before_after": {
      const before = resolveImage(block.before, context);
      const after = resolveImage(block.after, context);
      return (
        <Section id={block.id} type="before_after" title={block.title} intro={block.intro} wide>
          {before && after ? (
            <BeforeAfterSlider
              before={before}
              after={after}
              beforeLabel={block.beforeLabel}
              afterLabel={block.afterLabel}
            />
          ) : null}
        </Section>
      );
    }
    case "findings":
      return <FindingsBlock block={block} />;
    case "proposal":
      return <ProposalBlock block={block} />;
    case "mockup_gallery": {
      const images = block.images
        .map((image) => resolveImage(image, context))
        .filter((image): image is ResolvedImage => image !== null);
      return (
        <Section id={block.id} type="mockup_gallery" title={block.title} intro={block.intro} wide>
          <MockupGallery images={images} />
        </Section>
      );
    }
    case "brand_preview":
      return <BrandPreviewBlock block={block} context={context} />;
    case "roadmap":
      return <RoadmapBlock block={block} />;
    case "pricing":
      return (
        <Section id={block.id} type="pricing" title={block.title} intro={block.intro}>
          <PricingCalculator block={block} />
          {block.note ? <p className="text-foreground-muted">{block.note}</p> : null}
        </Section>
      );
    case "testimonials":
      return <TestimonialsBlock block={block} context={context} />;
    case "faq":
      return <FaqBlock block={block} />;
    case "about":
      return <AboutBlock block={block} context={context} />;
    case "contact":
      return <ContactBlock block={block} context={context} />;
    case "cta":
      return <CtaBlock block={block} />;
  }
}

export { blockTitle } from "@/domain/expose/outline";
