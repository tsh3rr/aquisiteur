"use client";

import { Check, Printer, Share2 } from "lucide-react";
import { useState } from "react";

/** "Als PDF speichern" (print stylesheet) and "Mit Kollegen teilen" (§7.3). */
export function FooterActions({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href.split("#")[0]!;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelled or unsupported payload: fall back to copying.
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  const button =
    "inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button type="button" className={button} onClick={() => window.print()}>
        <Printer aria-hidden className="size-4" />
        Als PDF speichern
      </button>
      <button type="button" className={button} onClick={() => void share()}>
        {copied ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Share2 aria-hidden className="size-4" />
        )}
        {copied ? "Link kopiert" : "Mit Kollegen teilen"}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Link in die Zwischenablage kopiert" : ""}
      </span>
    </div>
  );
}
