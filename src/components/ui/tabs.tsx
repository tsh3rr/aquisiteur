"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface HashTab {
  /** Also the URL hash that opens the tab. */
  key: string;
  label: string;
  /** Shown as a small number after the label. */
  count?: number;
  content: React.ReactNode;
}

/**
 * Tabs whose panels are all rendered on the server and only hidden on the
 * client. The URL hash picks the tab: either a tab key or the id of any
 * element inside a panel, so deep links like `#datenschutz` keep working.
 */
export function HashTabs({ label, tabs }: { label: string; tabs: HashTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  // Only the keys matter here; the panels change on every refresh.
  const keys = tabs.map((tab) => tab.key).join(" ");

  useEffect(() => {
    const sync = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (!hash) return;
      if (keys.split(" ").includes(hash)) {
        setActive(hash);
        return;
      }
      const target = document.getElementById(hash);
      const key = target?.closest<HTMLElement>("[data-tab]")?.dataset.tab;
      if (!target || !key) return;
      setActive(key);
      // The target was hidden when the browser tried to scroll to it.
      requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [keys]);

  const select = (key: string, focus = false) => {
    setActive(key);
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}${search}#${key}`);
    if (focus) tabRefs.current.get(key)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    select(tabs[next]!.key, true);
  };

  return (
    <div className="grid gap-6">
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab, index) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.key, node);
                else tabRefs.current.delete(tab.key);
              }}
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-4 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring",
                selected
                  ? "border-accent text-foreground"
                  : "border-transparent text-foreground-muted hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.count !== undefined ? (
                <span className="rounded-full bg-surface-sunken px-1.5 text-xs tabular-nums">
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`panel-${tab.key}`}
          aria-labelledby={`tab-${tab.key}`}
          data-tab={tab.key}
          hidden={tab.key !== active}
          className="min-w-0"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
