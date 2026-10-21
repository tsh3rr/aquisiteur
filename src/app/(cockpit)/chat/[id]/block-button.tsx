"use client";

import { Ban, CircleCheck } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { changeChatBlock } from "../actions";

/** „Chat sperren“ against abuse (ADR-0066): stops new messages and callbacks from the exposé. */
export function ChatBlockButton({
  threadId,
  prospectId,
  blocked,
}: {
  threadId: string;
  prospectId: string;
  blocked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={blocked ? "secondary" : "ghost"}
      disabled={pending}
      onClick={() => {
        if (
          !blocked &&
          !window.confirm(
            "Chat und Rückruf für diesen Kunden sperren? Im Exposé können dann keine Nachrichten und Rückrufwünsche mehr gesendet werden. Sie können die Sperre jederzeit aufheben.",
          )
        ) {
          return;
        }
        startTransition(() => changeChatBlock(threadId, prospectId, !blocked));
      }}
    >
      {blocked ? (
        <>
          <CircleCheck aria-hidden /> Sperre aufheben
        </>
      ) : (
        <>
          <Ban aria-hidden /> Chat sperren
        </>
      )}
    </Button>
  );
}
