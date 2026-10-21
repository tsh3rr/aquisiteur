"use client";

import { Activity } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { isRealtimeEvent } from "@/domain/realtime";
import { useLiveEvents } from "./live";

interface Item {
  key: string;
  prospectId: string;
  company: string;
  text: string;
  at: string;
}

const timeFormat = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

/**
 * „Jetzt gerade“ on Heute: who is in their exposé right now, one line per
 * prospect with the last sign of life; never what they read (ADR-0065).
 */
export function LiveFeed() {
  const [items, setItems] = useState<Item[]>([]);
  useLiveEvents((event, payload) => {
    if (!isRealtimeEvent("visit.activity", event, payload)) return;
    setItems((current) => {
      const item = { ...payload, key: payload.prospectId };
      const existing = current.find((entry) => entry.key === item.key);
      if (existing && existing.at >= item.at) return current;
      return [item, ...current.filter((entry) => entry.key !== item.key)].slice(0, 8);
    });
  });

  return (
    <section aria-labelledby="live-feed" className="grid gap-3">
      <h2 id="live-feed" className="flex items-center gap-2 text-lg font-semibold">
        <Activity aria-hidden className="size-4.5 text-accent" />
        Jetzt gerade
      </h2>
      <div aria-live="polite" aria-relevant="additions">
        {items.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            Sobald jemand ein Exposé liest, sehen Sie hier, dass er gerade da ist.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <time dateTime={item.at} className="text-foreground-muted tabular-nums">
                  {timeFormat.format(new Date(item.at))}
                </time>
                <Link
                  href={`/kunden/${item.prospectId}` as Route}
                  className="font-medium hover:underline"
                >
                  {item.company}
                </Link>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
