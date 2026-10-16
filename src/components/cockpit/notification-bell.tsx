"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { unreadNotifications } from "@/app/(cockpit)/benachrichtigungen/actions";
import { cn } from "@/lib/cn";
import { useLiveEvents } from "./live";

export const NOTIFICATIONS_READ_EVENT = "aq:notifications-read";

/** Link to the notification list with the unread count, kept current live (§7.7). */
export function NotificationBell({ initial, className }: { initial: number; className?: string }) {
  const [unread, setUnread] = useState(initial);
  const pathname = usePathname();
  const refresh = () => void unreadNotifications().then(setUnread, () => {});
  const generation = useLiveEvents((event) => {
    if (event === "notification.created") refresh();
  });
  useEffect(() => {
    if (generation > 1) refresh();
  }, [generation]);
  useEffect(() => {
    const onRead = () => setUnread(0);
    window.addEventListener(NOTIFICATIONS_READ_EVENT, onRead);
    return () => window.removeEventListener(NOTIFICATIONS_READ_EVENT, onRead);
  }, []);
  const label = unread > 0 ? `Benachrichtigungen (${unread} neu)` : "Benachrichtigungen";

  return (
    <Link
      href="/benachrichtigungen"
      title={label}
      aria-current={pathname === "/benachrichtigungen" ? "page" : undefined}
      className={cn(
        "relative grid size-11 place-items-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring aria-[current=page]:text-accent",
        className,
      )}
    >
      <Bell aria-hidden className="size-5" />
      <span className="sr-only">{label}</span>
      {unread > 0 ? (
        <span
          aria-hidden
          data-testid="notification-count"
          className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.625rem] leading-4 font-semibold text-accent-foreground"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
