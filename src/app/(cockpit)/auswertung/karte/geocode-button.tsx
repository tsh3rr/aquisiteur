"use client";

import { MapPin } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { geocodeNowAction, type GeocodeState } from "./actions";

/** Stays mounted after the refresh, so its result message remains readable. */
export function GeocodeNowButton({ pending: waiting }: { pending: number }) {
  const [state, action, pending] = useActionState<GeocodeState>(geocodeNowAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="secondary" disabled={pending || waiting === 0}>
        <MapPin aria-hidden />
        {pending ? "Sucht Adressen …" : "Jetzt verorten"}
      </Button>
      <p aria-live="polite" className="text-sm text-foreground-muted">
        {state.message ?? (waiting === 0 ? "Alle Adressen sind verortet." : null)}
      </p>
    </form>
  );
}
