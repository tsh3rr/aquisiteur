"use client";

import { useEffect } from "react";
import { NOTIFICATIONS_READ_EVENT } from "@/components/cockpit/notification-bell";

/** The page marked everything read on the server; clear the bell's badge too. */
export function MarkedRead() {
  useEffect(() => {
    window.dispatchEvent(new Event(NOTIFICATIONS_READ_EVENT));
  });
  return null;
}
