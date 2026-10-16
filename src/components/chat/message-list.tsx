import { MessageCircle } from "lucide-react";
import type { ChatMessageView } from "@/domain/realtime";
import { clsx as cn } from "clsx";

const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

/**
 * Chat messages for both sides (§7.5). `perspective` decides which side is
 * „mine“. A `role="log"` region announces new messages politely. The
 * WhatsApp handover renders as a button for the visitor when `whatsappHref`
 * is given.
 */
export function MessageList({
  messages,
  perspective,
  whatsappHref,
  otherName,
  className,
}: {
  messages: ChatMessageView[];
  perspective: "owner" | "visitor";
  whatsappHref?: string | null;
  /** Name shown for the other side's messages. */
  otherName?: string;
  className?: string;
}) {
  const otherLabel = otherName ?? (perspective === "owner" ? "Besucher" : "Antwort");
  return (
    <div role="log" aria-label="Nachrichten" className={className}>
      <ol className="grid content-start gap-3">
        {messages.map((message) => {
          const mine = message.author === perspective;
          const system = message.author === "system";
          const author = system ? "Automatische Nachricht" : mine ? "Sie" : otherLabel;
          return (
            <li
              key={message.id}
              className={cn(
                "grid max-w-[85%] gap-1",
                system
                  ? "justify-self-center text-center"
                  : mine
                    ? "justify-self-end"
                    : "justify-self-start",
              )}
            >
              <span className="sr-only">{author}: </span>
              <p
                className={cn(
                  "rounded-2xl px-3.5 py-2.5 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap",
                  system
                    ? "bg-surface-sunken text-foreground-muted"
                    : mine
                      ? "rounded-br-sm bg-accent text-accent-foreground"
                      : "rounded-bl-sm bg-surface-sunken text-foreground ring-1 ring-border",
                )}
              >
                {message.body}
              </p>
              {message.kind === "handover" && perspective === "visitor" && whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-contact-channel="whatsapp"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <MessageCircle aria-hidden className="size-4" /> Auf WhatsApp weiterschreiben
                </a>
              ) : null}
              <time
                dateTime={message.createdAt}
                className={cn("text-xs text-foreground-muted", mine && !system && "text-right")}
              >
                {!system ? <span aria-hidden>{author} · </span> : null}
                {time.format(new Date(message.createdAt))}
              </time>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
