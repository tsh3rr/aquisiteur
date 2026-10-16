"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { beat } from "@/app/(cockpit)/chat/actions";
import { PRESENCE_BEAT_MS } from "@/domain/chat";
import { subscribeRealtime, type RealtimeSubscription } from "@/infra/realtime-client";

/**
 * One realtime connection per cockpit tab (§6.4) on the workspace topic,
 * shared by everything that shows live data. Also reports the tab as open,
 * which makes the owner „Verfügbar“ in exposés (§7.4).
 */
type Listener = (event: string, payload: unknown) => void;

interface Live {
  listen(listener: Listener): () => void;
  /** Increments on every (re)connect; consumers refetch then. */
  generation: number;
}

const LiveContext = createContext<Live>({ listen: () => () => {}, generation: 0 });

export function LiveProvider({
  subscription,
  children,
}: {
  subscription: RealtimeSubscription;
  children: ReactNode;
}) {
  const listeners = useRef(new Set<Listener>());
  const [generation, setGeneration] = useState(0);
  const key = JSON.stringify(subscription);

  useEffect(() => {
    const parsed = JSON.parse(key) as RealtimeSubscription;
    return subscribeRealtime(parsed, {
      ssePath: "/api/live",
      onEvent: (event, payload) => {
        for (const listener of listeners.current) listener(event, payload);
      },
      onStatus: (connected) => {
        if (connected) setGeneration((value) => value + 1);
      },
    });
  }, [key]);

  useEffect(() => {
    const report = () => {
      if (document.visibilityState === "visible") void beat().catch(() => {});
    };
    report();
    const timer = window.setInterval(report, PRESENCE_BEAT_MS);
    document.addEventListener("visibilitychange", report);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", report);
    };
  }, []);

  const [value] = useState<Omit<Live, "generation">>(() => ({
    listen(listener) {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
  }));

  return <LiveContext.Provider value={{ ...value, generation }}>{children}</LiveContext.Provider>;
}

/** Subscribes `listener` to the workspace's live events while mounted. */
export function useLiveEvents(listener: Listener): number {
  const { listen, generation } = useContext(LiveContext);
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => listen((event, payload) => latest.current(event, payload)), [listen]);
  return generation;
}
