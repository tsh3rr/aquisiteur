/**
 * Events on the realtime topics (§6.4), shared by the publishers on the
 * server and the listeners in the cockpit and the exposé.
 */
export type ChatAuthor = "visitor" | "owner" | "system";
export type ChatMessageKind = "text" | "handover" | "offline";

/** A chat message as both sides see it. No user ids, no visit ids. */
export interface ChatMessageView {
  id: string;
  threadId: string;
  author: ChatAuthor;
  kind: ChatMessageKind;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
}

export type RealtimeEvent =
  | { event: "chat.message"; payload: { message: ChatMessageView; prospectId: string } }
  | {
      /** Only the owner's typing, shown to the visitor; visitors are never shown live (ADR-0065). */
      event: "chat.typing";
      payload: { threadId: string; prospectId: string; author: "owner"; typing: boolean };
    }
  /** Contact details or status of a thread changed. */
  | { event: "chat.thread"; payload: { threadId: string; prospectId: string } }
  | { event: "callback.created"; payload: { id: string; prospectId: string; name: string } }
  /** The contact-intent score of a prospect was recomputed (§7.6). */
  | { event: "intent.updated"; payload: { prospectId: string; score: number; level: string } }
  /** A new owner notification (§7.7); grouped updates do not repeat it. */
  | { event: "notification.created"; payload: { id: string; title: string; url: string } }
  /** A task was added, edited, done or deleted (§7.8). */
  | { event: "task.changed"; payload: { prospectId: string } }
  /** An offer was sent, viewed or answered (§7.10). */
  | { event: "offer.changed"; payload: { offerId: string; prospectId: string } }
  /** An invoice was created, edited, issued, cancelled or paid (§7.10). */
  | { event: "invoice.changed"; payload: { invoiceId: string; prospectId: string } }
  /** Live feed on „Heute“: what a prospect is doing right now. */
  | {
      event: "visit.activity";
      payload: { prospectId: string; company: string; text: string; at: string };
    };

export type RealtimeEventName = RealtimeEvent["event"];

/** Narrows an incoming event; anything unknown is dropped by the caller. */
export function isRealtimeEvent<N extends RealtimeEventName>(
  name: N,
  event: string,
  payload: unknown,
): payload is Extract<RealtimeEvent, { event: N }>["payload"] {
  return event === name && typeof payload === "object" && payload !== null;
}
