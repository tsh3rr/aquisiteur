import { cn } from "@/lib/cn";
import type { ResolvedImage } from "./render-context";

/**
 * Responsive image with AVIF and WebP sources. Width and height are always
 * set so the layout does not shift (CLS ≈ 0, §7.3).
 */
export function Picture({
  image,
  sizes,
  priority = false,
  className,
  imgClassName,
}: {
  image: ResolvedImage;
  sizes: string;
  priority?: boolean;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <picture className={className}>
      {image.avifSrcSet ? (
        <source type="image/avif" srcSet={image.avifSrcSet} sizes={sizes} />
      ) : null}
      <source type="image/webp" srcSet={image.webpSrcSet} sizes={sizes} />
      {/* Plain <img>: renditions are optimised at publish time (§5), not by next/image. */}
      <img
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding={priority ? "sync" : "async"}
        className={cn("h-auto w-full", imgClassName)}
      />
    </picture>
  );
}
