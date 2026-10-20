"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/auswertung", label: "Übersicht" },
  { href: "/auswertung/inhalte", label: "Inhalte" },
  { href: "/auswertung/karte", label: "Karte" },
] as const;

/** Dashboard sections; the filters travel along in the query string. */
export function AnalyticsTabs() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  return (
    <nav
      aria-label="Auswertungen"
      className="relative flex gap-1 overflow-x-auto border-b border-border"
    >
      {TABS.map((tab) => {
        const current = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={(query ? `${tab.href}?${query}` : tab.href) as Route}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center border-b-2 px-4 text-sm font-medium whitespace-nowrap",
              current
                ? "border-accent text-foreground"
                : "border-transparent text-foreground-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
