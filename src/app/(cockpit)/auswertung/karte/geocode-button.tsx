"use client";

import { MapPin } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { geocodeNowAction, type GeocodeState } from "./actions";

export function GeocodeNowButton() {
  const [state, action, pending] = useActionState<GeocodeState>(geocodeNowAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="secondary" disabled={pending}>
        <MapPin aria-hidden />
        {pending ? "Sucht Adressen …" : "Jetzt verorten"}
      </Button>
      <p aria-live="polite" className="text-sm text-foreground-muted">
        {state.message}
      </p>
    </form>
  );
}
