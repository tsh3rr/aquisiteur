"use client";

import { SendHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MessageList } from "@/components/chat/message-list";
import { MAX_MESSAGE_LENGTH, OFFLINE_AFTER_MS } from "@/domain/chat";
import { isRealtimeEvent, type ChatMessageView } from "@/domain/realtime";
import { subscribeRealtime, type RealtimeSubscription } from "@/infra/realtime-client";
import { cn } from "@/lib/cn";
import { visitToken } from "./tracking-client";

export interface ChatPanelProps {
  slug: string;
  open: boolean;
  onClose(): void;
  /** Owner replies that arrived while the panel was closed. */
  onUnread(count: number): void;
  /** Text to put into the field, e.g. from the pricing nudge. */
  prefill: string | null;
  responseTime: string;
  storeDraftContent: boolean;
  owner: { name: string; photo: string | null };
  whatsappHref: string | null;
  available: boolean;
}

interface Access {
  chat: string;
  live: RealtimeSubscription;
}

const TYPING_EVERY_MS = 1500;
const OWNER_TYPING_SHOWN_MS = 5000;

const storageKey = (slug: string) => `aq-chat:${slug}`;
function remember(slug: string, chat: string) {
  try {
    sessionStorage.setItem(storageKey(slug), chat);
  } catch {
    // Storage blocked: the chat still works for this page view.
  }
}
function recall(slug: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(slug));
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T | null }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { status: 0, data: null };
  const data = response.status === 204 ? null : ((await response.json().catch(() => null)) as T);
  return { status: response.status, data };
}

/**
 * The visitor's live chat (§7.5), loaded on demand. Panel on desktop,
 * bottom sheet on phones; not modal. Anonymous until the visitor leaves a
 * return channel, which it asks for after the first message. The thread's
 * token is kept in sessionStorage (this tab only) so a reload keeps the
 * conversation; nothing else is stored.
 */
export function ChatPanel(props: ChatPanelProps) {
  const { slug, open } = props;
  const [access, setAccess] = useState<Access | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerTyping, setOwnerTyping] = useState(false);
  const [asked, setAsked] = useState<"no" | "ask" | "done">("no");
  /** From the server when a conversation is restored; the page's value otherwise. */
  const [restoredAvailable, setRestoredAvailable] = useState<boolean | null>(null);
  const available = restoredAvailable ?? props.available;
  const panel = useRef<HTMLElement>(null);
  const [usedPrefill, setUsedPrefill] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  const trailingTyping = useRef<number | undefined>(undefined);
  const unread = useRef(0);
  const openRef = useRef(open);

  const add = (incoming: ChatMessageView[]) =>
    setMessages((current) => {
      const known = new Set(current.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      return fresh.length ? [...current, ...fresh] : current;
    });

  // Restore a conversation from earlier in this tab.
  useEffect(() => {
    const chat = recall(slug);
    if (!chat) return;
    void post<{
      messages: ChatMessageView[];
      access: Access;
      contact: { channel: string | null };
      available: boolean;
    }>("/t/chat/read", { chat }).then(({ data }) => {
      if (!data) return;
      setAccess(data.access);
      add(data.messages);
      setRestoredAvailable(data.available);
      setAsked(data.contact.channel ? "done" : "ask");
    });
  }, [slug]);

  // Listen for replies once the thread exists; refetch after reconnects.
  useEffect(() => {
    if (!access) return;
    return subscribeRealtime(access.live, {
      ssePath: "/t/live",
      onEvent(event, payload) {
        if (isRealtimeEvent("chat.message", event, payload)) {
          add([payload.message]);
          if (payload.message.author !== "visitor") {
            setOwnerTyping(false);
            if (!openRef.current) props.onUnread(++unread.current);
          }
        } else if (isRealtimeEvent("chat.typing", event, payload) && payload.author === "owner") {
          setOwnerTyping(payload.length > 0);
        }
      },
      onStatus(connected) {
        if (!connected) return;
        void post<{ messages: ChatMessageView[] }>("/t/chat/read", { chat: access.chat }).then(
          ({ data }) => data && add(data.messages),
        );
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one subscription per thread
  }, [access]);

  useEffect(() => {
    openRef.current = open;
    if (open) {
      unread.current = 0;
      props.onUnread(0);
      field.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open only
  }, [open]);

  // A nudge's prefilled text (e.g. the chosen pricing options), once.
  if (open && props.prefill && props.prefill !== usedPrefill) {
    setUsedPrefill(props.prefill);
    setText(props.prefill);
  }

  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && props.onClose();
    element.addEventListener("keydown", onKey);
    return () => element.removeEventListener("keydown", onKey);
  }, [props]);

  // Offline notice: two minutes after the visitor's last unanswered message.
  const lastVisitor = [...messages].reverse().find((m) => m.author === "visitor");
  const answered = lastVisitor
    ? messages.some((m) => m.author !== "visitor" && m.createdAt >= lastVisitor.createdAt)
    : true;
  useEffect(() => {
    if (!access || !lastVisitor || answered) return;
    const due = new Date(lastVisitor.createdAt).getTime() + OFFLINE_AFTER_MS + 1000 - Date.now();
    const timer = window.setTimeout(
      () =>
        void post<{ message: ChatMessageView | null }>("/t/chat/offline", {
          chat: access.chat,
        }).then(({ data }) => data?.message && add([data.message])),
      Math.max(0, due),
    );
    return () => window.clearTimeout(timer);
  }, [access, lastVisitor, answered]);

  useEffect(() => {
    if (!ownerTyping) return;
    const timer = window.setTimeout(() => setOwnerTyping(false), OWNER_TYPING_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [ownerTyping]);

  const sendTyping = async (value: string) => {
    lastTyping.current = Date.now();
    const token = await visitToken();
    if (!token) return;
    void post("/t/chat/typing", {
      token,
      chat: access?.chat,
      length: value.length,
      ...(props.storeDraftContent ? { content: value } : {}),
    });
  };

  // Throttled with a trailing report, so the owner always ends up with the latest length.
  const reportTyping = (value: string, force = false) => {
    window.clearTimeout(trailingTyping.current);
    const wait = TYPING_EVERY_MS - (Date.now() - lastTyping.current);
    if (force || wait <= 0) return void sendTyping(value);
    trailingTyping.current = window.setTimeout(() => void sendTyping(value), wait);
  };

  useEffect(() => () => window.clearTimeout(trailingTyping.current), []);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    window.clearTimeout(trailingTyping.current);
    setSending(true);
    setError(null);
    const token = await visitToken();
    if (!token) {
      setSending(false);
      setError("Der Chat ist gerade nicht erreichbar. Bitte nutzen Sie einen anderen Kontaktweg.");
      return;
    }
    const { status, data } = await post<{ message: ChatMessageView; access?: Access }>("/t/chat", {
      token,
      chat: access?.chat,
      body,
    });
    setSending(false);
    if (!data) {
      setError(
        status === 429
          ? "Bitte warten Sie einen Moment, bevor Sie weitere Nachrichten senden."
          : "Die Nachricht konnte nicht gesendet werden. Bitte versuchen Sie es noch einmal.",
      );
      return;
    }
    setText("");
    add([data.message]);
    if (data.access) {
      setAccess(data.access);
      remember(slug, data.access.chat);
    }
    setAsked((current) => (current === "no" ? "ask" : current));
  };

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="aq-chat-title"
      ref={panel}
      hidden={!open}
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border border-border bg-background shadow-2xl md:inset-x-auto md:right-4 md:bottom-4 md:h-[min(36rem,calc(100dvh-2rem))] md:w-[24rem] md:rounded-2xl"
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        {props.owner.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-scaled asset
          <img
            src={props.owner.photo}
            alt=""
            width={40}
            height={40}
            className="size-10 rounded-full object-cover"
          />
        ) : null}
        <div className="grid flex-1 leading-tight">
          <h2 id="aq-chat-title" className="font-semibold">
            Chat mit {props.owner.name}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
            {available ? (
              <>
                <span aria-hidden className="size-2 rounded-full bg-success" /> Verfügbar
              </>
            ) : (
              props.responseTime
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="grid size-11 place-items-center rounded-full text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <X aria-hidden className="size-5" />
          <span className="sr-only">Chat schließen</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <p className="mb-4 rounded-2xl bg-surface-sunken px-3.5 py-2.5 text-sm">
          Hallo! Schreiben Sie mir einfach hier. Sie müssen dafür nichts von sich angeben.
        </p>
        <MessageList
          messages={messages}
          perspective="visitor"
          whatsappHref={props.whatsappHref}
          otherName={props.owner.name}
        />
        {asked === "ask" ? (
          <ReturnChannel chat={access?.chat ?? null} onDone={() => setAsked("done")} />
        ) : null}
      </div>

      <form
        className="grid gap-2 border-t border-border px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <p aria-live="polite" className="min-h-5 text-xs text-foreground-muted">
          {ownerTyping ? `${props.owner.name} schreibt …` : ""}
        </p>
        <label htmlFor="aq-chat-text" className="sr-only">
          Ihre Nachricht
        </label>
        {props.storeDraftContent ? (
          <p id="aq-chat-draft" className="text-xs text-foreground-muted">
            Ihr Entwurf wird automatisch gespeichert, damit nichts verloren geht.
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            id="aq-chat-text"
            ref={field}
            rows={2}
            value={text}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Ihre Nachricht"
            aria-describedby={props.storeDraftContent ? "aq-chat-draft" : undefined}
            onChange={(event) => {
              setText(event.target.value);
              reportTyping(event.target.value);
            }}
            onBlur={() => reportTyping(text, true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            className="min-h-11 flex-1 resize-none rounded-xl border border-border-strong bg-surface px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50"
          >
            <SendHorizontal aria-hidden className="size-5" />
            <span className="sr-only">Senden</span>
          </button>
        </div>
        <p role="alert" className={cn("text-sm text-danger-soft-foreground", !error && "sr-only")}>
          {error ?? ""}
        </p>
      </form>
    </section>
  );
}

const inputClass =
  "min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring";

/** „Wie erreiche ich Sie, falls Sie das Fenster schließen?“ (§7.5) */
function ReturnChannel({ chat, onDone }: { chat: string | null; onDone(): void }) {
  const [channel, setChannel] = useState<"email" | "phone" | "whatsapp">("email");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  if (!chat) return null;
  if (saved) {
    return (
      <p
        role="status"
        className="mt-4 rounded-2xl bg-accent-soft px-3.5 py-2.5 text-sm text-accent-soft-foreground"
      >
        Danke, so erreiche ich Sie auch, wenn Sie das Fenster schließen.
      </p>
    );
  }
  return (
    <form
      noValidate
      className="mt-4 grid gap-3 rounded-2xl border border-border p-3.5 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        void post<{ fields?: Record<string, string> }>("/t/chat/contact", {
          ...data,
          chat,
          channel,
        }).then(({ status, data: body }) => {
          if (status === 204) {
            setSaved(true);
            window.setTimeout(onDone, 4000);
          } else {
            setErrors(
              body?.fields ?? { _: "Das hat nicht geklappt. Bitte noch einmal versuchen." },
            );
          }
        });
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium">
          Wie erreiche ich Sie, falls Sie das Fenster schließen?
        </legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["email", "E-Mail"],
              ["whatsapp", "WhatsApp"],
              ["phone", "Telefon"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-focus-ring"
            >
              <input
                type="radio"
                name="channel-choice"
                value={value}
                checked={channel === value}
                onChange={() => setChannel(value)}
                className="size-4 accent-accent"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-1">
        <label htmlFor="aq-return-name">
          Name <span className="text-foreground-muted">(optional)</span>
        </label>
        <input
          id="aq-return-name"
          name="name"
          autoComplete="name"
          maxLength={120}
          className={inputClass}
        />
      </div>
      {channel === "email" ? (
        <div className="grid gap-1">
          <label htmlFor="aq-return-email">E-Mail-Adresse</label>
          <input
            id="aq-return-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "aq-return-email-error" : undefined}
            className={inputClass}
          />
          {errors.email ? (
            <p id="aq-return-email-error" className="text-danger-soft-foreground">
              {errors.email}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-1">
          <label htmlFor="aq-return-phone">
            {channel === "whatsapp" ? "Handynummer" : "Telefonnummer"}
          </label>
          <input
            id="aq-return-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? "aq-return-phone-error" : undefined}
            className={inputClass}
          />
          {errors.phone ? (
            <p id="aq-return-phone-error" className="text-danger-soft-foreground">
              {errors.phone}
            </p>
          ) : null}
        </div>
      )}
      {errors._ ? <p className="text-danger-soft-foreground">{errors._}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-semibold text-accent-foreground hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Speichern
        </button>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex min-h-11 items-center rounded-xl px-3 text-foreground-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          Später
        </button>
      </div>
    </form>
  );
}
