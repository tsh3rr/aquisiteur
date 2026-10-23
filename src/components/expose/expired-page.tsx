import { ArrowDown, Check } from "lucide-react";
import { EXPIRED_SECTIONS, type ExpiredPage } from "@/domain/expose/expiry";
import type { ExposeDocument } from "@/domain/expose/schema";
import { Block } from "./blocks";
import { OwnerBadge } from "./owner";
import type { RenderContext } from "./render-context";
import { Section } from "./section";

const monthYear = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
  timeZone: "Europe/Berlin",
});

/**
 * Short page of an expired exposé (§7.3 „Ablauf“): an honest note that the
 * ideas are older, the comparison slider, what would change as headings
 * only, then every contact channel. One goal, one call to action, no
 * table of contents, prices or details: the offer is a fresh look, not the
 * old proposal (ADR-0078).
 */
export function ExpiredContent({
  page,
  document,
  preparedAt,
  context,
}: {
  page: ExpiredPage;
  document: ExposeDocument;
  preparedAt: Date;
  context: RenderContext;
}) {
  const hero = document.blocks.find((block) => block.type === "hero");
  const company = context.prospectName;
  const introId = EXPIRED_SECTIONS.intro;
  return (
    <>
      <section
        id={introId}
        data-block="expired_intro"
        aria-labelledby={`${introId}-title`}
        className="relative overflow-hidden px-5 pt-10 pb-12 sm:px-8 sm:pt-16 sm:pb-16"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_40%,var(--aq-accent-soft),transparent)]"
        />
        <div className="mx-auto grid max-w-3xl gap-6">
          <p className="text-sm font-semibold tracking-wide text-accent uppercase">Für {company}</p>
          <div className="grid gap-3">
            {hero?.type === "hero" ? (
              <p className="text-xl text-foreground-muted">{hero.greeting}</p>
            ) : null}
            <h1
              id={`${introId}-title`}
              className="font-display text-4xl leading-[1.05] text-balance sm:text-5xl"
            >
              Diese Ideen sind schon eine Weile her.
            </h1>
          </div>
          <p className="max-w-prose text-lg text-pretty text-foreground-muted sm:text-xl">
            Ich habe sie im {monthYear.format(preparedAt)} für {company} zusammengestellt. Seitdem
            hat sich bei Ihnen und im Netz sicher einiges getan, deshalb sehen Sie hier nur noch das
            Wichtigste auf einen Blick.
          </p>
          <p className="max-w-prose text-lg text-pretty">
            Gern schaue ich mir Ihren Auftritt noch einmal frisch an und sage Ihnen, was sich heute
            lohnt. Kostenlos und unverbindlich.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <a
              href={`#${page.contact.id}`}
              data-cta
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Aktuelle Einschätzung anfordern
              <ArrowDown aria-hidden className="size-4" />
            </a>
            <OwnerBadge context={context} />
          </div>
        </div>
      </section>

      {page.beforeAfter ? <Block block={page.beforeAfter} context={context} /> : null}

      {page.points.length > 0 ? (
        <Section
          id={EXPIRED_SECTIONS.points}
          type="expired_points"
          title={`Was ich bei ${company} ändern würde`}
        >
          <ol className="grid gap-3 sm:grid-cols-2">
            {page.points.map((point) => (
              <li
                key={point}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 font-medium"
              >
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground"
                >
                  <Check className="size-4" />
                </span>
                {point}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Block block={page.contact} context={context} />
    </>
  );
}
