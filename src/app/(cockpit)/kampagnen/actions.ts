"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { campaignFormSchema, fieldErrors } from "@/domain/prospects/schema";
import { createCampaign, deleteCampaign, updateCampaign } from "@/server/campaigns";
import { requireCockpit } from "@/server/session";

export interface CampaignFormState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

async function manager() {
  const context = await requireCockpit();
  assertCan(context.actor, "prospects.manage", { workspaceId: context.workspace.id });
  return context;
}

const TAKEN = "Eine Kampagne mit diesem Namen gibt es schon.";

export async function createCampaignAction(
  _state: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  const { actor, tenant } = await manager();
  const parsed = campaignFormSchema.safeParse({
    name: form.get("name"),
    description: form.get("description"),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const id = await tenant((tx) => createCampaign(tx, actor, parsed.data));
  if (!id) return { ok: false, errors: { name: TAKEN } };
  revalidatePath("/kampagnen");
  redirect(`/kampagnen/${id}`);
}

export async function updateCampaignAction(
  id: string,
  _state: CampaignFormState,
  form: FormData,
): Promise<CampaignFormState> {
  const { actor, tenant } = await manager();
  const parsed = campaignFormSchema.safeParse({
    name: form.get("name"),
    description: form.get("description"),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const result = await tenant((tx) =>
    updateCampaign(tx, actor, z.uuid().parse(id), {
      ...parsed.data,
      archived: form.get("archived") === "on",
    }),
  );
  if (result === "taken") return { ok: false, errors: { name: TAKEN } };
  if (result === "missing") return { ok: false, message: "Die Kampagne gibt es nicht mehr." };
  revalidatePath("/kampagnen");
  revalidatePath(`/kampagnen/${id}`);
  return { ok: true, message: "Gespeichert." };
}

export async function deleteCampaignAction(id: string) {
  const { actor, tenant } = await manager();
  await tenant((tx) => deleteCampaign(tx, actor, z.uuid().parse(id)));
  revalidatePath("/kampagnen");
  revalidatePath("/kunden");
  redirect("/kampagnen");
}
