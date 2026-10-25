import { cn } from "@/lib/cn";

/** Wordmark: an envelope fold that doubles as an upward arrow. */
export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" aria-hidden className="size-7 shrink-0">
        <rect width="32" height="32" rx="9" className="fill-accent" />
        <path
          d="M8 21.5V12l8 6 8-6v9.5Z"
          fill="none"
          className="stroke-accent-foreground"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M16 6.5v6M13.2 9 16 6.2 18.8 9"
          fill="none"
          className="stroke-accent-foreground"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {compact ? (
        <span className="sr-only">Aquisiteur</span>
      ) : (
        <span className="text-lg">Aquisiteur</span>
      )}
    </span>
  );
}
