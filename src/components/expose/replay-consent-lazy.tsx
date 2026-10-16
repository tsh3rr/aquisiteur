"use client";

import { useEffect, useState, type ComponentType } from "react";

type Props = { privacyHref: string };

/**
 * Loads the replay notice once the page is idle, so its code stays off the
 * critical path for the first paint (ADR-0014). The notice waits several
 * seconds before asking anyway (ADR-0042).
 */
export function ReplayConsentLazy(props: Props) {
  const [Notice, setNotice] = useState<ComponentType<Props> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void import("./replay-consent").then((module) => {
        if (!cancelled) setNotice(() => module.ReplayConsent);
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
