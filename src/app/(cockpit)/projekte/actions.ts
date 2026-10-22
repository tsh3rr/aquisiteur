"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { projectFormSchema, PROJECT_STATUSES } from "@/domain/projects";
import { fieldErrors } from "@/domain/prospects/schema";
import { createOffer } from "@/server/offers/manage";
import { createProject, deleteProject, updateProject } from "@/server/projects";
import { requireCockpit } from "@/server/session";

/** Cockpit side of projects (§7.10). */

export interface ProjectFormState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

async function manager() {
  const context = await requireCockpit();
  assertCan(context.actor, "prospects.manage", { workspaceId: context.workspace.id });
  return context;
}

const id = z.uuid();

/** New project on the customer page; opens it right away. */
export async function createProjectAction(
  _: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const { actor, tenant } = await manager();
  const prospectId = id.safeParse(formData.get("prospectId"));
  const parsed = projectFormSchema.safeParse(Object.fromEntries(formData));
  if (!prospectId.success) return { ok: false, message: "Kunde nicht gefunden." };
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const projectId = await tenant((tx) => createProject(tx, actor, prospectId.data, parsed.data));
  if (!projectId) return { ok: false, message: "Kunde nicht gefunden." };
  revalidatePath(`/kunden/${prospectId.data}`);
  redirect(`/projekte/${projectId}`);
}

const updateSchema = projectFormSchema.extend({ status: z.enum(PROJECT_STATUSES) });

export async function updateProjectAction(
  _: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const { actor, tenant } = await manager();
  const projectId = id.safeParse(formData.get("id"));
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!projectId.success) return { ok: false, message: "Projekt nicht gefunden." };
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const prospectId = await tenant((tx) => updateProject(tx, actor, projectId.data, parsed.data));
  if (!prospectId) return { ok: false, message: "Projekt nicht gefunden." };
  revalidatePath(`/projekte/${projectId.data}`);
  revalidatePath(`/kunden/${prospectId}`);
  return { ok: true, message: "Projekt gespeichert." };
}

export async function deleteProjectAction(formData: FormData) {
  const { actor, tenant } = await manager();
  const projectId = id.parse(formData.get("id"));
  const result = await tenant((tx) => deleteProject(tx, actor, projectId));
  if ("error" in result) redirect(`/projekte/${projectId}?fehler=${result.error}`);
  revalidatePath(`/kunden/${result.prospectId}`);
  redirect(`/kunden/${result.prospectId}`);
}

/** New offer in a project, optionally prefilled from catalogue entries. */
export async function createOfferAction(formData: FormData) {
  const { actor, tenant } = await manager();
  const projectId = id.parse(formData.get("projectId"));
  const catalogItemIds = z
    .array(z.uuid())
    .max(30)
    .catch([])
    .parse(formData.getAll("catalogItemId"));
  const title = z
    .string()
    .max(160)
    .catch("")
    .parse(formData.get("title") ?? "");
  const offerId = await tenant((tx) =>
    createOffer(tx, actor, projectId, { title, catalogItemIds }),
  );
  if (!offerId) redirect(`/projekte/${projectId}`);
  revalidatePath(`/projekte/${projectId}`);
  redirect(`/angebote/${offerId}`);
}
