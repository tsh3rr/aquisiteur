import { signToken, verifyToken } from "@/domain/tracking/signed-token";
import type { RealtimePort } from "../types";

/**
 * In-process realtime for development, tests and single-instance Node
 * hosting: publishers and Server-Sent-Event streams share one bus in this
 * process. Cannot work across Worker isolates; Cloudflare uses Supabase.
 */
type Listener = (data: string) => void;

const BUS = Symbol.for("aquisiteur.realtime.bus");
const TOKEN_TTL = 12 * 60 * 60;
const KEEPALIVE_MS = 20_000;

function bus(): Map<string, Set<Listener>> {
  // One bus per process, even when Next loads this module in several bundles.
  const holder = globalThis as { [BUS]?: Map<string, Set<Listener>> };
  holder[BUS] ??= new Map();
  return holder[BUS];
}

const encoder = new TextEncoder();

export function memoryRealtime(secret: string): RealtimePort {
  return {
    provider: "memory",
    async publish(topic, event, payload) {
      const listeners = bus().get(topic);
      if (!listeners) return;
      const data = JSON.stringify({ event, payload });
      for (const listener of listeners) listener(data);
    },
    async subscription(topic) {
      return { kind: "sse", token: await signToken(secret, "live", topic, TOKEN_TTL) };
    },
    async stream(token, signal) {
      const topic = await verifyToken(secret, "live", token);
      if (!topic) return null;
      let cleanup = () => {};
      return new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (chunk: string) => {
            try {
              controller.enqueue(encoder.encode(chunk));
            } catch {
              cleanup();
            }
          };
          const listener: Listener = (data) => send(`data: ${data}\n\n`);
          const listeners = bus().get(topic) ?? new Set();
          listeners.add(listener);
          bus().set(topic, listeners);
          const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
          cleanup = () => {
            clearInterval(keepalive);
            listeners.delete(listener);
            if (listeners.size === 0) bus().delete(topic);
            try {
              controller.close();
            } catch {
              // already closed
            }
          };
          signal.addEventListener("abort", cleanup, { once: true });
          send("retry: 3000\n: connected\n\n");
        },
        cancel() {
          cleanup();
        },
      });
    },
  };
}
