"use client";

import {
  BarChart3,
  FileText,
  Flag,
  ListChecks,
  Mail,
  MessageCircle,
  Palette,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { unreadCount } from "@/app/(cockpit)/chat/actions";
import { isRealtimeEvent } from "@/domain/realtime";
import { cn } from "@/lib/cn";
import { useLiveEvents } from "./live";

const items: { href: Route; label: string; icon: typeof Sun; mobile: boolean }[] = [
  { href: "/", label: "Heute", icon: Sun, mobile: true },
  { href: "/kunden", label: "Kunden", icon: Users, mobile: true },
  { href: "/aufgaben", label: "Aufgaben", icon: ListChecks, mobile: false },
  { href: "/kampagnen", label: "Kampagnen", icon: Flag, mobile: false },
  { href: "/briefe", label: "Briefe", icon: Mail, mobile: false },
  { href: "/auswertung", label: "Auswertung", icon: BarChart3, mobile: false },
  { href: "/chat", label: "Chat", icon: MessageCircle, mobile: true },
  { href: "/exposes", label: "Exposés", icon: FileText, mobile: true },
  { href: "/settings", label: "Einstellungen", icon: Settings, mobile: true },
  { href: "/design", label: "Design-System", icon: Palette, mobile: false },
];

export const UNREAD_EVENT = "aq:unread-chats";

/** Unread chats plus open callback requests, kept current by the live connection. */
function useUnread(initial: number) {
  const [unread, setUnread] = useState(initial);
  const refresh = () => void unreadCount().then(setUnread, () => {});
  const generation = useLiveEvents((event, payload) => {
    if (
      (isRealtimeEvent("chat.message", event, payload) && payload.message.author === "visitor") ||
      event === "callback.created"
    ) {
      refresh();
    }
  });
  useEffect(() => {
    if (generation > 1) refresh();
  }, [generation]);
  useEffect(() => {
    // The thread page reports the new count after marking a thread read.
    const onRead = (event: Event) => setUnread((event as CustomEvent<number>).detail);
    window.addEventListener(UNREAD_EVENT, onRead);
    return () => window.removeEventListener(UNREAD_EVENT, onRead);
  }, []);
  return unread;
}

export function CockpitNav({
  orientation,
  unread: initialUnread = 0,
}: {
  orientation: "vertical" | "horizontal";
  unread?: number;
}) {
  const pathname = usePathname();
  const unread = useUnread(initialUnread);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav aria-label="Hauptnavigation" className={orientation === "vertical" ? "px-3" : ""}>
      <ul className={orientation === "vertical" ? "grid gap-0.5" : "grid grid-cols-5"}>
        {items
          .filter((item) => orientation === "vertical" || item.mobile)
          .map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md text-sm font-medium text-foreground-muted transition-colors hover:text-foreground",
                  orientation === "vertical"
                    ? "h-10 px-2.5 hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:text-foreground aria-[current=page]:shadow-sm"
                    : "h-16 flex-col justify-center gap-1 text-xs aria-[current=page]:text-accent",
                )}
              >
                <span className="relative">
                  <Icon aria-hidden className="size-4.5" />
                  {href === "/chat" && unread > 0 ? (
                    <span
                      aria-hidden
                      className="absolute -top-1.5 -right-2 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.625rem] leading-4 font-semibold text-accent-foreground"
                    >
                      {unread > 9 ? "9+" : unread}
                    </span>
                  ) : null}
                </span>
                {label}
                {href === "/chat" && unread > 0 ? (
                  <span className="sr-only">
                    ({unread} {unread === 1 ? "neue Anfrage" : "neue Anfragen"})
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  );
}
