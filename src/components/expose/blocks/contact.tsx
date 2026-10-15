import { Mail, MessageCircle, Phone } from "lucide-react";
import { contactLinks, type ContactChannel } from "@/domain/expose/contact-links";
import type { BlockOf } from "@/domain/expose/schema";
import { OwnerBadge } from "../owner";
import type { RenderContext } from "../render-context";
import { Section } from "../section";

const channelUi: Record<ContactChannel, { label: string; icon: typeof Mail }> = {
  whatsapp: { label: "WhatsApp schreiben", icon: MessageCircle },
  phone: { label: "Anrufen", icon: Phone },
  email: { label: "E-Mail schreiben", icon: Mail },
};

/**
 * Contact channels from the workspace settings with prefilled text and
 * reference (§7.4). Live chat, callback and booking follow in phase 3.
 */
export function ContactBlock({
  block,
  context,
}: {
  block: BlockOf<"contact">;
  context: RenderContext;
}) {
  const links = contactLinks({
    channels: block.channels,
    settings: context.settings.channels,
    message: block.message,
    company: context.prospectName,
    refCode: context.refCode,
  });
  return (
    <Section id={block.id} type="contact" title={block.title} intro={block.intro}>
      <div className="grid gap-6 rounded-2xl bg-surface p-6 shadow-md ring-1 ring-border sm:p-8">
        <OwnerBadge context={context} />
        {links.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {links.map((link, index) => {
              const ui = channelUi[link.channel];
              return (
                <li key={link.channel} className={index === 0 ? "sm:col-span-2" : undefined}>
                  <a
                    href={link.href}
                    data-contact-channel={link.channel}
                    {...(link.channel === "whatsapp"
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    className={
                      index === 0
                        ? "flex min-h-14 items-center gap-3 rounded-xl bg-accent px-5 py-3 text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                        : "flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-5 py-3 transition-colors hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    }
                  >
                    <ui.icon aria-hidden className="size-5 shrink-0" />
                    <span className="grid leading-tight">
                      <span className="font-semibold">{ui.label}</span>
                      <span className={index === 0 ? "text-sm" : "text-sm text-foreground-muted"}>
                        {link.display}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-foreground-muted">Kontaktdaten werden gerade eingerichtet.</p>
        )}
        <p className="text-sm text-foreground-muted">
          Ihre Referenz:{" "}
          <span className="font-semibold tracking-wider text-foreground">{context.refCode}</span>
        </p>
      </div>
    </Section>
  );
}
