"use client";

import { Check, FileDown, Share2 } from "lucide-react";
import { useRef, useState } from "react";
import type { PrintableExpose } from "@/domain/expose/print";
import { shareUrl, track } from "./tracking-client";

/** Option ids the reader ticked in each price frame, for the PDF's totals. */
function pricingSelection(): Record<string, string[]> {
  const selected: Record<string, string[]> = {};
  document.querySelectorAll<HTMLInputElement>("input[data-pricing-option]").forEach((input) => {
    const block = input.closest("section[data-block]")?.id;
    if (!block) return;
    selected[block] ??= [];
    if (input.checked) selected[block].push(input.dataset.pricingOption!);
  });
  return selected;
}

/**
 * "Als PDF speichern" (§7.3, §7.9): the designed exposé PDF, rendered in
 * the browser on the first click; the print stylesheet stays the fallback
 * (and is all the cockpit preview offers). "Mit Kollegen teilen" next to it.
 */
export function FooterActions({ title, pdfSource }: { title: string; pdfSource: string | null }) {
  const [copied, setCopied] = useState(false);
  const [pdf, setPdf] = useState<"idle" | "working" | "done">("idle");
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
  const savePdf = async () => {
    if (pdf === "working") return;
    if (!pdfSource) {
      window.print();
      return;
    }
    setPdf("working");
    try {
      const response = await fetch(pdfSource);
      if (!response.ok) throw new Error(`PDF data: ${response.status}`);
      const doc = (await response.json()) as PrintableExpose;
      const { downloadExposePdf } = await import("@/components/expose-pdf/download");
      await downloadExposePdf(
        { ...doc, url: window.location.origin + window.location.pathname },
        pricingSelection(),
      );
      track({ type: "pdf_download" });
      setPdf("done");
    } catch (error) {
      console.error(error);
      setPdf("idle");
      // The print view still gives a PDF; it reports the download itself (beforeprint).
      window.print();
    }
  };
  const button =
    "inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button
        type="button"
        className={button}
        aria-busy={pdf === "working"}
        onClick={() => void savePdf()}
      >
        <FileDown aria-hidden className="size-4" />
        {pdf === "working" ? "PDF wird erstellt …" : "Als PDF speichern"}
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
        {copied ? "Link in die Zwischenablage kopiert" : pdf === "done" ? "PDF gespeichert" : ""}
      </span>
    </div>
  );
}
