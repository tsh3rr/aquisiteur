"use client";

import { FileText, Palette, Settings, Sun, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/cn";

const items: { href: Route; label: string; icon: typeof Sun; mobile: boolean }[] = [
  { href: "/", label: "Heute", icon: Sun, mobile: true },
  { href: "/kunden", label: "Kunden", icon: Users, mobile: true },
  { href: "/exposes", label: "Exposés", icon: FileText, mobile: true },
  { href: "/settings", label: "Einstellungen", icon: Settings, mobile: true },
  { href: "/design", label: "Design-System", icon: Palette, mobile: false },
];

export function CockpitNav({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav aria-label="Hauptnavigation" className={orientation === "vertical" ? "px-3" : ""}>
      <ul className={orientation === "vertical" ? "grid gap-0.5" : "grid grid-cols-4"}>
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
                <Icon aria-hidden className="size-4.5" />
                {label}
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  );
}
