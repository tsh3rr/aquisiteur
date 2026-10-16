import type { BlockOf } from "@/domain/expose/schema";
import { contrastRatio, hexToOklch } from "@/lib/color";
import { cn } from "@/lib/cn";
import { Picture } from "../picture";
import { resolveImage, type RenderContext } from "../render-context";
import { Section } from "../section";

const WHITE = { l: 1, c: 0, h: 0 };
const BLACK = { l: 0, c: 0, h: 0 };

const fontClass = {
  sans: "font-sans",
  serif: "font-display",
  display: "font-display",
  mono: "font-mono",
} as const;

export function BrandPreviewBlock({
  block,
  context,
}: {
  block: BlockOf<"brand_preview">;
  context: RenderContext;
}) {
  return (
    <Section id={block.id} type="brand_preview" title={block.title} intro={block.intro} wide>
      {block.colors.length > 0 ? (
        <div className="grid gap-3">
          <h3 className="text-lg font-semibold">Farben</h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {block.colors.map((color) => {
              const oklch = hexToOklch(color.value);
              const onColor =
                contrastRatio(WHITE, oklch) >= contrastRatio(BLACK, oklch) ? "#ffffff" : "#111111";
              return (
                <li
                  key={color.name}
                  className="grid aspect-[4/3] content-end gap-0.5 rounded-xl p-4 shadow-sm ring-1 ring-border"
                  style={{ backgroundColor: color.value, color: onColor }}
                >
                  <span className="font-semibold">{color.name}</span>
                  <span className="font-mono text-sm uppercase">{color.value}</span>
                  {color.usage ? <span className="text-sm">{color.usage}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {block.typography.length > 0 ? (
        <div className="grid gap-3">
          <h3 className="text-lg font-semibold">Schrift</h3>
          <ul className="grid gap-3 md:grid-cols-2">
            {block.typography.map((type) => (
              <li
                key={type.role}
                className="grid gap-2 rounded-xl border border-border bg-surface p-6 shadow-sm"
              >
                <span className="text-sm text-foreground-muted">
                  {type.role} · {type.family}
                </span>
                <span className={cn("text-3xl", fontClass[type.style])}>{type.sample}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-foreground-muted">Schriftproben in ähnlicher Darstellung.</p>
        </div>
      ) : null}
      {block.logos.length > 0 ? (
        <div className="grid gap-3">
          <h3 className="text-lg font-semibold">Logo</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {block.logos.map((logo) => {
              const image = resolveImage(logo, context);
              return image ? (
                <li
                  key={logo.src}
                  className="grid place-items-center rounded-xl border border-border bg-[#fff] p-8"
                >
                  <Picture
                    image={image}
                    sizes="(min-width: 640px) 400px, 90vw"
                    className="w-full max-w-xs"
                  />
                </li>
              ) : null;
            })}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
