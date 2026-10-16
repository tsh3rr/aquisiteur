import {
  CalendarDays,
  Mail,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Phone,
  Smartphone,
} from "lucide-react";
import { contactLinks, type LinkChannel } from "@/domain/expose/contact-links";
import type { BlockOf } from "@/domain/expose/schema";
import { cn } from "@/lib/cn";
import { CallbackOption } from "../callback-form";
import { OwnerBadge } from "../owner";
import type { RenderContext } from "../render-context";
import { Section } from "../section";

const linkUi: Record<LinkChannel, { label: string; icon: typeof Mail }> = {
  whatsapp: { label: "WhatsApp schreiben", icon: MessageCircle },
  phone: { label: "Anrufen", icon: Phone },
  email: { label: "E-Mail schreiben", icon: Mail },
  booking: { label: "Termin buchen", icon: CalendarDays },
  messenger: { label: "Messenger", icon: MessagesSquare },
  sms: { label: "SMS schreiben", icon: Smartphone },
};

export const optionClass = (primary: boolean) =>
  cn(
    "flex min-h-14 w-full items-center gap-3 rounded-xl px-5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
    primary
      ? "bg-accent text-accent-foreground shadow-sm hover:bg-accent-hover"
      : "border border-border bg-surface hover:border-border-strong hover:bg-surface-sunken",
  );

/**
 * Every v1 contact channel (§7.4) in the exposé's order: live chat and the
 * callback form open in the page, the rest are links with a prefilled text
 * that carries the reference. Channels without a configured target are
 * left out.
 */
export function ContactBlock({
  block,
  context,
}: {
  block: BlockOf<"contact">;
  context: RenderContext;
}) {
  const links = new Map(
    contactLinks({
      channels: block.channels,
      settings: context.settings.channels,
      message: block.message,
      company: context.prospectName,
      refCode: context.refCode,
    }).map((link) => [link.channel, link]),
  );
  const options = block.channels.filter((channel) =>
    channel === "chat"
      ? context.settings.chat.enabled
      : channel === "callback"
        ? true
        : links.has(channel),
  );

  return (
    <Section id={block.id} type="contact" title={block.title} intro={block.intro}>
      <div className="grid gap-6 rounded-2xl bg-surface p-6 shadow-md ring-1 ring-border sm:p-8">
        <OwnerBadge context={context} />
        {options.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {options.map((channel, index) => {
              const primary = index === 0;
              const wide = primary ? "sm:col-span-2" : undefined;
              if (channel === "chat") {
                return (
                  <li key={channel} className={wide}>
                    <button type="button" data-open-chat="contact" className={optionClass(primary)}>
                      <MessageSquareText aria-hidden className="size-5 shrink-0" />
                      <span className="grid leading-tight">
                        <span className="font-semibold">Live-Chat</span>
                        <span className={primary ? "text-sm" : "text-sm text-foreground-muted"}>
                          {context.settings.chat.responseTime}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              }
              if (channel === "callback") {
                return (
                  <CallbackOption
                    key={channel}
                    slug={context.slug}
                    primary={primary}
                    disabled={context.mode === "preview"}
                  />
                );
              }
              const link = links.get(channel)!;
              const ui = linkUi[link.channel];
              return (
                <li key={channel} className={wide}>
                  <a
                    href={link.href}
                    data-contact-channel={link.channel}
                    {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className={optionClass(primary)}
                  >
                    <ui.icon aria-hidden className="size-5 shrink-0" />
                    <span className="grid leading-tight">
                      <span className="font-semibold">
                        {ui.label}
                        {link.external ? (
                          <span className="sr-only"> (öffnet neues Fenster)</span>
                        ) : null}
                      </span>
                      <span className={primary ? "text-sm" : "text-sm text-foreground-muted"}>
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
