"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { ContactLayerProps, OpenSource } from "./contact-layer";

/**
 * Loads the contact layer (launcher, nudges, sticky bar) once the page is
 * idle, so its code stays off the critical path for the first paint
 * (ADR-0014). A chat button pressed before that loads it at once and opens
 * the chat.
 */
export function ContactLayerLazy(props: ContactLayerProps) {
  const [Layer, setLayer] = useState<ComponentType<ContactLayerProps> | null>(null);
  const [openWith, setOpenWith] = useState<OpenSource | undefined>(undefined);

  useEffect(() => {
    let done = false;
    let loaded = false;
    const load = () => {
      if (done) return;
      done = true;
      void import("./contact-layer").then((module) => {
        loaded = true;
        setLayer(() => module.ContactLayer);
      });
    };
    const onClick = (event: MouseEvent) => {
      if (loaded) return; // the layer handles chat buttons itself from now on
      const trigger = (event.target as Element | null)?.closest<HTMLElement>("[data-open-chat]");
      if (!trigger) return;
      event.preventDefault();
      setOpenWith((trigger.dataset.openChat as OpenSource) || "contact");
      load();
    };
    document.addEventListener("click", onClick);
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
      document.removeEventListener("click", onClick);
      window.removeEventListener("load", idle);
    };
  }, []);

  return Layer ? <Layer {...props} openWith={openWith} /> : null;
}
