"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Opens the target of a tapped push notification in this window. The service
 * worker sends it here when the browser cannot navigate an open window itself
 * (WindowClient.navigate is missing or refuses, e.g. in some installed apps).
 */
export function NotificationNavigator() {
  const router = useRouter();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "notification.open" || typeof data.url !== "string") return;
      const target = new URL(data.url, window.location.origin);
      if (target.origin !== window.location.origin) return;
      router.push(`${target.pathname}${target.search}${target.hash}` as Route);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);
  return null;
}
