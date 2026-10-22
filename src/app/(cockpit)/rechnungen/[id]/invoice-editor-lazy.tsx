"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { Skeleton } from "@/components/ui/misc";
import type { InvoiceEditor as Editor } from "./invoice-editor";

type Props = ComponentProps<typeof Editor>;

/**
 * Loads the invoice editor on mount, like the offer editor (ADR-0067): it is
 * aliased out of the server bundle, so the Worker stays small.
 */
export function InvoiceEditorLazy(props: Props) {
  const [Loaded, setLoaded] = useState<typeof Editor | null>(null);
  useEffect(() => {
    let active = true;
    void import("./invoice-editor").then((module) => {
      if (active) setLoaded(() => module.InvoiceEditor);
    });
    return () => {
      active = false;
    };
  }, []);
  if (!Loaded) {
    return (
      <div aria-busy="true" aria-label="Rechnung wird geladen" className="grid gap-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  return <Loaded {...props} />;
}
