"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { ConsentNoticeProps } from "./consent-notice";

/**
 * Loads the consent notice once the page is idle, so its code stays off the
 * critical path for the first paint (ADR-0014). Nothing beyond the basis is
 * sent before the visitor answers, so the short wait costs nothing (ADR-0065).
 */
export function ConsentNoticeLazy(props: ConsentNoticeProps) {
  const [Notice, setNotice] = useState<ComponentType<ConsentNoticeProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void import("./consent-notice").then((module) => {
        if (!cancelled) setNotice(() => module.ConsentNotice);
      });
    };
    const idle = () => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(load, { timeout: 2000 });
      } else {
        setTimeout(load, 200);
      }
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", idle);
    };
  }, []);

  return Notice ? <Notice {...props} /> : null;
}
