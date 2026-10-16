import { Mail, MessageCircle, MessageSquareText, Phone } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ActionKind, Explanation } from "@/domain/intent/explain";
import { LEVEL_LABELS, type IntentLevel } from "@/domain/intent/score";
import { cn } from "@/lib/cn";

const ringTone: Record<IntentLevel, string> = {
  curious: "text-foreground-subtle",
  interested: "text-accent",
  likely: "text-warning",
  very_likely: "text-danger",
  confirmed: "text-success",
};

/**
 * Contact-intent score as a ring (§7.6). The number and the level are text,
 * so the colour is never the only signal (§8).
 */
export function ScoreRing({
  score,
  level,
  size = "md",
}: {
  score: number;
  level: IntentLevel;
  size?: "sm" | "md";
}) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  return (
    <span
      role="img"
      aria-label={`Kontaktabsicht ${score} %: ${LEVEL_LABELS[level]}`}
      className={cn(
        "relative inline-grid shrink-0 place-items-center",
        size === "md" ? "size-16" : "size-12",
      )}
    >
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle cx="24" cy="24" r={radius} fill="none" strokeWidth="5" className="stroke-border" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(score, 100) / 100)}
          className={cn(
            ringTone[level],
            "transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none",
          )}
        />
      </svg>
      <span
        aria-hidden
        className={cn("font-semibold tabular-nums", size === "md" ? "text-base" : "text-sm")}
      >
        {score}
        <span className="text-[0.65em]">%</span>
      </span>
    </span>
  );
}

const actionIcons: Record<ActionKind, typeof Phone> = {
  call: Phone,
  whatsapp: MessageSquareText,
  email: Mail,
  chat: MessageCircle,
};

/** One-click actions from the recommendation: call, WhatsApp, e-mail, reply in the chat. */
export function IntentActions({ actions }: { actions: Explanation["actions"] }) {
  if (actions.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Kontakt aufnehmen">
      {actions.map((action, index) => {
        const Icon = actionIcons[action.kind];
        const className = cn(
          "inline-flex h-11 items-center gap-2 rounded-md px-4 text-sm font-medium shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
          index === 0
            ? "bg-accent text-accent-foreground hover:bg-accent-hover"
            : "border border-border bg-surface hover:bg-surface-sunken",
        );
        const content = (
          <>
            <Icon aria-hidden className="size-4" />
            {action.label}
          </>
        );
        return (
          <li key={`${action.kind}-${action.href}`}>
            {action.href.startsWith("/") ? (
              <Link href={action.href as Route} className={className}>
                {content}
              </Link>
            ) : action.href.startsWith("https:") ? (
              <a href={action.href} target="_blank" rel="noopener noreferrer" className={className}>
                {content}
                <span className="sr-only">(öffnet in neuem Tab)</span>
              </a>
            ) : (
              <a href={action.href} className={className}>
                {content}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Score, explanation, recommendation and actions for one prospect. */
export function IntentSummary({
  score,
  level,
  explanation,
  company,
  href,
  headingLevel = "h3",
}: {
  score: number;
  level: IntentLevel;
  explanation: Explanation;
  company?: string;
  href?: Route;
  headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;
  return (
    <div className="flex gap-4" data-testid="intent-summary">
      <ScoreRing score={score} level={level} />
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="grid gap-0.5">
          {company ? (
            <Heading className="font-semibold">
              {href ? (
                <Link href={href} className="hover:underline">
                  {company}
                </Link>
              ) : (
                company
              )}
            </Heading>
          ) : null}
          <p className={company ? "text-sm font-medium" : "font-semibold"}>
            {explanation.headline}
          </p>
          {explanation.detail ? (
            <p className="text-sm text-foreground-muted">{explanation.detail}</p>
          ) : null}
        </div>
        <p className="text-sm">
          <span className="font-medium">Empfehlung: </span>
          {explanation.recommendation}
        </p>
        <IntentActions actions={explanation.actions} />
      </div>
    </div>
  );
}
