"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { THEME_COOKIE, type ThemePreference } from "./theme";

const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Hell", icon: Sun },
  { value: "dark", label: "Dunkel", icon: Moon },
];

/** Radio group: light / dark / follow the OS. Stored in a first-party cookie (UI preference only). */
export function ThemeToggle({ initial }: { initial: ThemePreference }) {
  const [value, setValue] = useState(initial);

  function choose(next: ThemePreference) {
    setValue(next);
    applyTheme(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Farbschema"
      className="inline-flex rounded-md border border-border bg-surface-sunken p-0.5"
    >
      {options.map(({ value: option, label, icon: Icon }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          title={label}
          onClick={() => choose(option)}
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-[calc(var(--aq-radius-md)-2px)] text-foreground-muted transition-colors pointer-coarse:size-11",
            "hover:text-foreground aria-checked:bg-surface aria-checked:text-foreground aria-checked:shadow-sm",
          )}
        >
          <Icon aria-hidden className="size-4" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}

function applyTheme(next: ThemePreference) {
  const root = document.documentElement;
  if (next === "system") delete root.dataset.theme;
  else root.dataset.theme = next;
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}
