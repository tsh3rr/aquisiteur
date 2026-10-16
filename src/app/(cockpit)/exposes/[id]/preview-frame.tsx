"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Cockpit preview without tracking (§7.2), switchable between phone and desktop width. */
export function PreviewFrame({ src, title }: { src: string; title: string }) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const option = (value: "mobile" | "desktop", label: string, Icon: typeof Monitor) => (
    <button
      type="button"
      aria-pressed={device === value}
      onClick={() => setDevice(value)}
      className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground-muted aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11"
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </button>
  );
  return (
    <div className="grid gap-3">
      <div
        role="group"
        aria-label="Vorschaugröße"
        className="inline-flex w-fit gap-1 rounded-lg bg-surface-sunken p-1"
      >
        {option("mobile", "Mobil", Smartphone)}
        {option("desktop", "Desktop", Monitor)}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface-sunken p-3">
        <iframe
          src={src}
          title={title}
          className={cn(
            "mx-auto block h-[44rem] rounded-lg border border-border bg-background shadow-md transition-[width] duration-300 motion-reduce:transition-none",
            device === "mobile" ? "w-[390px] max-w-full" : "w-full",
          )}
        />
      </div>
    </div>
  );
}
