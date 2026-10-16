"use client";

import { MessageCircle, SendHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useLiveEvents } from "@/components/cockpit/live";
import { UNREAD_EVENT } from "@/components/cockpit/nav";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { MAX_MESSAGE_LENGTH } from "@/domain/chat";
import { isRealtimeEvent, type ChatMessageView } from "@/domain/realtime";
import { markRead, ownerTyping, sendOwnerMessage } from "../actions";
import { MessageList } from "@/components/chat/message-list";

const TYPING_SHOWN_MS = 6000;
const TYPING_THROTTLE_MS = 2500;

/**
 * The owner's live chat (§7.5): messages appear as the visitor sends them,
 * with a typing indicator and the length of what they are typing but have
 * not sent (draft detection).
 */
export function ThreadView({
  threadId,
  prospectId,
  initialMessages,
  initialDraft,
  canHandOver,
  visitorName,
}: {
  threadId: string;
  prospectId: string;
  initialMessages: ChatMessageView[];
  initialDraft: { length: number; content: string | null } | null;
  canHandOver: boolean;
  visitorName: string | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [typing, setTyping] = useState<{ length: number; live: boolean } | null>(
    initialDraft ? { length: initialDraft.length, live: false } : null,
  );
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lastTypingSent = useRef(0);

  const router = useRouter();
  const add = (message: ChatMessageView) =>
    setMessages((current) =>
      current.some((m) => m.id === message.id) ? current : [...current, message],
    );

  const read = () =>
    void markRead(threadId).then(
      (count) => window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: count })),
      () => {},
    );

  useLiveEvents((event, payload) => {
    if (isRealtimeEvent("chat.message", event, payload) && payload.message.threadId === threadId) {
      add(payload.message);
      if (payload.message.author === "visitor") {
        setTyping(null);
        if (document.visibilityState === "visible") read();
      }
    } else if (isRealtimeEvent("chat.thread", event, payload) && payload.threadId === threadId) {
      // The visitor left a return channel: the side card shows it.
      router.refresh();
    } else if (
      isRealtimeEvent("chat.typing", event, payload) &&
      payload.author === "visitor" &&
      (payload.threadId === threadId || (!payload.threadId && payload.prospectId === prospectId))
    ) {
      setTyping(payload.length > 0 ? { length: payload.length, live: true } : null);
    }
  });

  useEffect(() => {
    read();
    const onVisible = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per thread
  }, [threadId]);

  // The live indicator fades; an older draft stays as a quiet note.
  useEffect(() => {
    if (!typing?.live) return;
    const timer = window.setTimeout(
      () => setTyping((current) => (current ? { ...current, live: false } : null)),
      TYPING_SHOWN_MS,
    );
    return () => window.clearTimeout(timer);
  }, [typing]);
  const typingNow = typing?.live ?? false;

  const send = (kind: "text" | "handover") => {
    setError(null);
    startTransition(async () => {
      const result = await sendOwnerMessage(threadId, kind === "text" ? text : "", kind);
      if (result.ok) {
        add(result.message);
        if (kind === "text") setText("");
      } else {
        setError(result.message);
      }
    });
  };

  const onChange = (value: string) => {
    setText(value);
    const now = Date.now();
    if (now - lastTypingSent.current > TYPING_THROTTLE_MS) {
      lastTypingSent.current = now;
      void ownerTyping(threadId, value.length).catch(() => {});
    }
  };

  return (
    <section
      aria-label="Unterhaltung"
      className="grid gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6"
    >
      <MessageList messages={messages} perspective="owner" otherName={visitorName ?? undefined} />

      <p aria-live="polite" className="min-h-5 text-sm text-foreground-muted">
        {typingNow
          ? `Schreibt gerade … (${typing!.length} Zeichen)`
          : typing && typing.length > 0
            ? `Hat ${typing.length} Zeichen getippt, aber noch nicht gesendet.`
            : ""}
        {!typingNow && initialDraft?.content ? (
          <span className="mt-1 block rounded-md bg-surface-sunken p-2 text-foreground">
            Entwurf: „{initialDraft.content}“
          </span>
        ) : null}
      </p>

      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) send("text");
        }}
      >
        <label htmlFor="owner-reply" className="text-sm font-medium">
          Antwort
        </label>
        <Textarea
          id="owner-reply"
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (text.trim()) send("text");
            }
          }}
          aria-describedby="owner-reply-hint"
          aria-invalid={error ? true : undefined}
        />
        <p id="owner-reply-hint" className="text-xs text-foreground-muted">
          Enter sendet, Umschalt + Enter macht eine neue Zeile.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger-soft-foreground">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || !text.trim()}>
            <SendHorizontal aria-hidden /> Senden
          </Button>
          {canHandOver ? (
            <Button variant="secondary" disabled={pending} onClick={() => send("handover")}>
              <MessageCircle aria-hidden /> Auf WhatsApp weitermachen
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
