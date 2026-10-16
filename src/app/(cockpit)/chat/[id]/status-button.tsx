"use client";

import { CheckCheck, RotateCcw } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { changeThreadStatus } from "../actions";

export function ThreadStatusButton({
  threadId,
  status,
}: {
  threadId: string;
  status: "open" | "closed";
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(() => changeThreadStatus(threadId, status === "open" ? "closed" : "open"))
      }
    >
      {status === "open" ? (
        <>
          <CheckCheck aria-hidden /> Als erledigt markieren
        </>
      ) : (
        <>
          <RotateCcw aria-hidden /> Wieder öffnen
        </>
      )}
    </Button>
  );
}
