"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLiveEvents } from "@/components/cockpit/live";

/** Re-renders the server page when one of `events` arrives (or after a reconnect). */
export function LiveRefresh({ events, prospectId }: { events: string[]; prospectId?: string }) {
  const router = useRouter();
  const timer = useRef(0);
  const refresh = () => {
    // Bursts (a visitor typing several messages) cause one refresh.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => router.refresh(), 300);
  };
  const generation = useLiveEvents((event, payload) => {
    if (!events.includes(event)) return;
    if (prospectId && (payload as { prospectId?: string } | null)?.prospectId !== prospectId) {
      return;
    }
    refresh();
  });
  useEffect(() => {
    if (generation > 1) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on reconnect
  }, [generation]);
  return null;
}
