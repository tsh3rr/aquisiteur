import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Wrapper of every block: a labelled landmark with a stable id, used for the
 * table of contents, CTA targets and (phase 2) per-section tracking.
 */
export function Section({
  id,
  type,
  title,
  intro,
  children,
  className,
  wide = false,
  hiddenTitle = false,
}: {
  id: string;
  type: string;
  title?: string;
  intro?: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
  hiddenTitle?: boolean;
}) {
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      data-block={type}
      aria-labelledby={title ? titleId : undefined}
      className={cn("expose-reveal scroll-mt-24 px-5 py-14 sm:px-8 sm:py-20", className)}
    >
      <div className={cn("mx-auto grid gap-8", wide ? "max-w-6xl" : "max-w-3xl")}>
        {title ? (
          <header className={cn("grid gap-3", hiddenTitle && "sr-only")}>
            <h2
              id={titleId}
              className="font-display text-3xl leading-tight text-balance sm:text-4xl"
            >
              {title}
            </h2>
            {intro ? <p className="text-lg text-pretty text-foreground-muted">{intro}</p> : null}
          </header>
        ) : null}
        {children}
      </div>
    </section>
  );
}
