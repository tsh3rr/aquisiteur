import { ChevronDown } from "lucide-react";
import type { BlockOf } from "@/domain/expose/schema";
import { RichText } from "../rich-text";
import { Section } from "../section";

/** Native <details> accordion: keyboard and screen reader support without JS. */
export function FaqBlock({ block }: { block: BlockOf<"faq"> }) {
  return (
    <Section id={block.id} type="faq" title={block.title}>
      <div className="grid divide-y divide-border rounded-xl border border-border bg-surface shadow-sm">
        {block.items.map((item, index) => (
          <details key={index} className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-lg font-medium [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronDown
                aria-hidden
                className="size-5 shrink-0 text-foreground-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <RichText source={item.answer} className="px-5 pb-5 text-foreground-muted" />
          </details>
        ))}
      </div>
    </Section>
  );
}
