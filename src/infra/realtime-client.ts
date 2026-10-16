import type { RealtimeSubscription } from "./types";

/**
 * Browser side of the RealtimePort (§6.4): listens on one topic, whatever
 * the provider. The only file under src/infra/ that client components may
 * import. Dependency-free on purpose; the exposé loads it with the chat.
 *
 * `onStatus(true)` fires on every (re)connect: callers refetch then, since
 * events sent while disconnected are not replayed.
 */
export interface RealtimeHandlers {
  onEvent(event: string, payload: unknown): void;
  onStatus?(connected: boolean): void;
}

export function subscribeRealtime(
  subscription: RealtimeSubscription,
  options: RealtimeHandlers & { ssePath: string },
): () => void {
  return subscription.kind === "sse"
    ? sse(`${options.ssePath}?token=${encodeURIComponent(subscription.token)}`, options)
    : supabase(subscription, options);
}

function dispatch(raw: string, handlers: RealtimeHandlers) {
  try {
    const message = JSON.parse(raw) as { event?: unknown; payload?: unknown };
    if (typeof message.event === "string") handlers.onEvent(message.event, message.payload);
  } catch {
    // ignore malformed frames
  }
}

function sse(url: string, handlers: RealtimeHandlers): () => void {
  // EventSource reconnects on its own (the stream sends `retry: 3000`).
  const source = new EventSource(url);
  source.onopen = () => handlers.onStatus?.(true);
  source.onerror = () => handlers.onStatus?.(false);
  source.onmessage = (message) => dispatch(message.data as string, handlers);
  return () => source.close();
}

/** Minimal Phoenix channel client for Supabase Realtime broadcast. */
function supabase(
  subscription: Extract<RealtimeSubscription, { kind: "supabase" }>,
  handlers: RealtimeHandlers,
): () => void {
  const channel = `realtime:${subscription.topic}`;
  let socket: WebSocket | null = null;
  let heartbeat = 0;
  let retry = 0;
  let attempts = 0;
  let ref = 0;
  let closed = false;

  const send = (event: string, payload: unknown, topic = channel) =>
    socket?.readyState === WebSocket.OPEN &&
    socket.send(JSON.stringify({ topic, event, payload, ref: String(++ref), join_ref: "1" }));

  const connect = () => {
    const url = `${subscription.url}?apikey=${encodeURIComponent(subscription.apiKey)}&vsn=1.0.0`;
    socket = new WebSocket(url);
    socket.onopen = () => {
      attempts = 0;
      send("phx_join", {
        config: { broadcast: { self: false, ack: false }, presence: { key: "" }, private: false },
      });
      heartbeat = window.setInterval(() => send("heartbeat", {}, "phoenix"), 25_000);
    };
    socket.onmessage = (message) => {
      try {
        const frame = JSON.parse(message.data as string) as {
          topic: string;
          event: string;
          payload: { status?: string; event?: string; payload?: unknown };
        };
        if (frame.topic !== channel) return;
        if (frame.event === "phx_reply" && frame.payload.status === "ok" && ref <= 2) {
          handlers.onStatus?.(true);
        } else if (frame.event === "broadcast" && typeof frame.payload.event === "string") {
          handlers.onEvent(frame.payload.event, frame.payload.payload);
        }
      } catch {
        // ignore malformed frames
      }
    };
    socket.onclose = () => {
      window.clearInterval(heartbeat);
      if (closed) return;
      handlers.onStatus?.(false);
      ref = 0;
      retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts++));
    };
  };
  connect();

  return () => {
    closed = true;
    window.clearTimeout(retry);
    window.clearInterval(heartbeat);
    socket?.close();
  };
}
