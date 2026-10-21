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

const TYPING_THROTTLE_MS = 2500;

/**
 * The owner's live chat (§7.5): messages appear as the visitor sends them.
 * Whether the visitor started a message without sending it shows as a quiet
 * note, never live and never with its length or text (ADR-0065).
 */
export function ThreadView({
  threadId,
  initialMessages,
  draftPending: initialDraftPending,
  canHandOver,
  visitorName,
}: {
  threadId: string;
  initialMessages: ChatMessageView[];
  /** The visitor started a message without sending it (yes/no only). */
  draftPending: boolean;
  canHandOver: boolean;
  visitorName: string | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draftPending, setDraftPending] = useState(initialDraftPending);
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
        setDraftPending(false);
        if (document.visibilityState === "visible") read();
      }
    } else if (isRealtimeEvent("chat.thread", event, payload) && payload.threadId === threadId) {
      // The visitor left a return channel: the side card shows it.
      router.refresh();
    }
  });

  useEffect(() => {
    read();
    const onVisible = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per thread
  }, [threadId]);

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
      void ownerTyping(threadId, value.length > 0).catch(() => {});
    }
  };

  return (
    <section
      aria-label="Unterhaltung"
      className="grid gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6"
    >
      <MessageList messages={messages} perspective="owner" otherName={visitorName ?? undefined} />

      <p aria-live="polite" className="min-h-5 text-sm text-foreground-muted">
        {draftPending ? "Hat angefangen zu schreiben, aber noch nicht gesendet." : ""}
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
