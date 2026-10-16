"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { assertCan } from "@/domain/authz";
import { geocodePending } from "@/server/geocoding";
import { requireCockpit } from "@/server/session";

export interface GeocodeState {
  message?: string;
}

/**
 * Looks up a few waiting addresses right away instead of waiting for the
 * hourly job. Writes only coordinates of this workspace's prospects.
 */
export async function geocodeNowAction(): Promise<GeocodeState> {
  const { actor, workspace } = await requireCockpit();
  assertCan(actor, "prospects.manage", { workspaceId: workspace.id });
  const result = await geocodePending(getDb(), { workspaceId: workspace.id, limit: 10 });
  revalidatePath("/auswertung/karte");
  if (result.failed) {
    return {
      message: "Der Kartendienst antwortet gerade nicht. Später geht es automatisch weiter.",
    };
  }
  return {
    message: `${result.found} Adressen gefunden${result.missed ? `, ${result.missed} nicht gefunden` : ""}.`,
  };
}
