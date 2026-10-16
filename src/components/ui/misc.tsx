import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-sunken px-1 font-mono text-[0.7rem] text-foreground-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Loading placeholder. Hidden from assistive tech; pair with an aria-busy region. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export function Separator({ className, ...props }: ComponentProps<"hr">) {
  return <hr className={cn("border-0 border-t border-border", className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="text-foreground-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Horizontally scrollable area (wide tables). Focusable so keyboard users
 * can scroll it (WCAG 2.1.1); the label names it for screen readers.
 */
export function ScrollRegion({
  label,
  className,
  ...props
}: ComponentProps<"div"> & { label: string }) {
  /* eslint-disable jsx-a11y/no-noninteractive-tabindex -- scroll containers need focus */
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        className,
      )}
      {...props}
    />
  );
}
