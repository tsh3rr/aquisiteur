"use client";

import { useEffect, useState, type ComponentProps, type ComponentType } from "react";
import { Skeleton } from "@/components/ui/misc";
import type { OfferEditor } from "./offer-editor";

type Props = ComponentProps<typeof OfferEditor>;

/**
 * The editor is browser-only: it loads on mount and is aliased out of the
 * server bundle in next.config.ts, so the Worker stays within the free plan
 * (ADR-0035, ADR-0067). The server sends the page around it with a skeleton.
 */
export function OfferEditorLazy(props: Props) {
  const [Editor, setEditor] = useState<ComponentType<Props> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("./offer-editor").then((module) => {
      if (!cancelled) setEditor(() => module.OfferEditor);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (Editor) return <Editor {...props} />;
  return (
    <div aria-busy="true" aria-label="Angebotseditor wird geladen" className="grid gap-6">
      <Skeleton className="h-72" />
      <Skeleton className="h-96" />
    </div>
  );
}
