"use client";

import { Check, Phone, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { telHref } from "@/domain/expose/contact-links";
import { formatRelative } from "@/lib/relative-time";
import { markCallback } from "./actions";

export interface CallbackView {
  id: string;
  prospectId: string;
  companyName: string;
  name: string;
  phone: string;
  preferredTime: string | null;
  note: string | null;
  status: "open" | "done";
  createdAt: Date;
}

/** „Rückruf anfordern“ requests (§7.4) with a done toggle. */
export function CallbackList({
  callbacks,
  showCompany = false,
}: {
  callbacks: CallbackView[];
  showCompany?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <ul className="grid gap-2">
      {callbacks.map((callback) => (
        <li
          key={callback.id}
          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <div className="grid gap-1 text-sm">
            <p className="font-semibold">
              {callback.name}
              {showCompany ? (
                <>
                  {" · "}
                  <Link
                    href={`/kunden/${callback.prospectId}`}
                    className="font-normal text-accent underline-offset-4 hover:underline"
                  >
                    {callback.companyName}
                  </Link>
                </>
              ) : null}
            </p>
            <a
              href={telHref(callback.phone)}
              className="inline-flex min-h-11 items-center gap-2 font-medium text-accent underline-offset-4 hover:underline"
            >
              <Phone aria-hidden className="size-4" />
              {callback.phone}
            </a>
            {callback.preferredTime ? <p>Wunschzeit: {callback.preferredTime}</p> : null}
            {callback.note ? <p className="text-foreground-muted">„{callback.note}“</p> : null}
            <p className="text-xs text-foreground-muted">
              <time dateTime={callback.createdAt.toISOString()}>
                {formatRelative(callback.createdAt)}
              </time>
              {callback.status === "done" ? (
                <>
                  {" "}
                  <Badge tone="success">Erledigt</Badge>
                </>
              ) : null}
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(() => markCallback(callback.id, callback.status === "open"))
            }
          >
            {callback.status === "open" ? (
              <>
                <Check aria-hidden /> Erledigt
              </>
            ) : (
              <>
                <RotateCcw aria-hidden /> Wieder öffnen
              </>
            )}
            <span className="sr-only">: Rückruf für {callback.name}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
