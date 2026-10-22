"use client";

import { Receipt } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createInvoicesFromOfferAction } from "../../rechnungen/actions";

/** Accepted offer → one invoice draft per open instalment (§7.10). */
export function CreateInvoicesButton({ offerId }: { offerId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await createInvoicesFromOfferAction(offerId)))}
        className="justify-self-start"
      >
        <Receipt aria-hidden className="size-4" />
        {pending ? "Wird angelegt …" : "Rechnungen aus Tranchen erstellen"}
      </Button>
      <p
        aria-live="polite"
        className={result && !result.ok ? "text-sm text-danger" : "text-sm text-foreground-muted"}
      >
        {result?.message}
      </p>
    </div>
  );
}
