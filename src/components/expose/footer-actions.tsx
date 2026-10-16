"use client";

import { Check, Printer, Share2 } from "lucide-react";
import { useRef, useState } from "react";
import { shareUrl, track } from "./tracking-client";

/** "Als PDF speichern" (print stylesheet) and "Mit Kollegen teilen" (§7.3). */
export function FooterActions({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  // Fetched as the finger or pointer approaches, so the share sheet still
  // opens within the click's user activation (Safari is strict about it).
  const link = useRef<Promise<string | null> | null>(null);
  const prepare = () => {
    link.current ??= shareUrl().catch(() => null);
  };
  const share = async () => {
    track({ type: "share" });
    prepare();
    // A link of its own makes forwarded reads visible; the page URL is the fallback.
    const url = (await link.current) ?? window.location.href.split("#")[0]!;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Unsupported payload or no activation left: fall back to copying.
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
      <button
        type="button"
        className={button}
        onPointerEnter={prepare}
        onPointerDown={prepare}
        onFocus={prepare}
        onClick={() => void share()}
      >
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
