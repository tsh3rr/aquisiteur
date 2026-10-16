"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteCampaignAction } from "./actions";

export function DeleteCampaignButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteCampaignAction.bind(null, id)}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Kampagne „${name}“ löschen? Kunden und Briefe bleiben erhalten, nur ohne Kampagne.`,
          )
        )
          event.preventDefault();
      }}
    >
      <Button type="submit" variant="ghost">
        <Trash2 aria-hidden />
        Kampagne löschen
      </Button>
    </form>
  );
}
