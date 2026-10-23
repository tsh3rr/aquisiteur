"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { PROSPECT_ANCHORS } from "@/domain/notifications";
import { canonicalViewQuery } from "@/domain/prospects/list-query";
import {
  contactFormSchema,
  fieldErrors,
  prospectFormSchema,
  statusSchema,
} from "@/domain/prospects/schema";
import { STATUS_LABELS } from "@/domain/prospects/status";
import { checkShortCode, normalizeShortCode } from "@/domain/tracking/short-links";
import {
  addContact,
  addTouchpoint,
  createProspect,
  deleteProspect,
  restrictProspect,
  setDoNotContact,
  deleteView,
  removeContact,
  saveView,
  setProspectStatus,
  setTouchpointEnabled,
  updateProspect,
} from "@/server/prospects/mutations";
import { assignCampaign } from "@/server/campaigns";
import { requireCockpit } from "@/server/session";

export interface FormState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

async function manager() {
  const context = await requireCockpit();
  assertCan(context.actor, "prospects.manage", { workspaceId: context.workspace.id });
  return context;
}

function revalidateCustomers(id?: string) {
  revalidatePath("/kunden");
  revalidatePath("/kunden/pipeline");
  if (id) revalidatePath(`/kunden/${id}`);
}

/** Status change for one prospect (detail page, pipeline) or a selection (list). */
export async function changeStatus(ids: string[], status: string): Promise<FormState> {
  const { actor, tenant } = await manager();
  const parsedIds = z.array(z.uuid()).max(500).safeParse(ids);
  const parsedStatus = statusSchema.safeParse(status);
  if (!parsedIds.success || !parsedStatus.success) {
    return { ok: false, message: "Ungültige Auswahl." };
  }
  const changed = await tenant((tx) =>
    setProspectStatus(tx, actor, parsedIds.data, parsedStatus.data),
  );
  revalidateCustomers(parsedIds.data.length === 1 ? parsedIds.data[0] : undefined);
  const label = STATUS_LABELS[parsedStatus.data];
  return {
    ok: true,
    message:
      changed === 0
        ? `Status war schon „${label}“.`
        : changed === 1
          ? `Status auf „${label}“ gesetzt.`
          : `${changed} Kunden auf „${label}“ gesetzt.`,
  };
}

/** Puts the selected prospects into a campaign; "" removes them from any. */
export async function assignCampaignAction(ids: string[], campaignId: string): Promise<FormState> {
  const { actor, tenant } = await manager();
  const parsedIds = z.array(z.uuid()).max(500).safeParse(ids);
  const parsedCampaign = z.union([z.uuid(), z.literal("")]).safeParse(campaignId);
  if (!parsedIds.success || !parsedCampaign.success) {
    return { ok: false, message: "Ungültige Auswahl." };
  }
  const changed = await tenant((tx) =>
    assignCampaign(tx, actor, parsedIds.data, parsedCampaign.data || null),
  );
  revalidateCustomers();
  revalidatePath("/kampagnen");
  if (changed === 0) return { ok: false, message: "Kampagne nicht gefunden." };
  return {
    ok: true,
    message: parsedCampaign.data
      ? `${changed} ${changed === 1 ? "Kunde" : "Kunden"} der Kampagne zugewiesen.`
      : `${changed} ${changed === 1 ? "Kunde" : "Kunden"} ohne Kampagne.`,
  };
}

export async function createProspectAction(_: FormState, formData: FormData): Promise<FormState> {
  const { actor, tenant } = await manager();
  const parsed = prospectFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const id = await tenant((tx) => createProspect(tx, actor, parsed.data));
  revalidateCustomers();
  redirect(`/kunden/${id}`);
}

export async function updateProspectAction(_: FormState, formData: FormData): Promise<FormState> {
  const { actor, tenant } = await manager();
  const id = z.uuid().safeParse(formData.get("id"));
  const parsed = prospectFormSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return { ok: false, message: "Kunde nicht gefunden." };
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const found = await tenant((tx) => updateProspect(tx, actor, id.data, parsed.data));
  if (!found) return { ok: false, message: "Kunde nicht gefunden." };
  revalidateCustomers(id.data);
  return { ok: true, message: "Gespeichert." };
}

/** Sets or lifts the block marker (Sperrvermerk) on the customer page. */
export async function setDoNotContactAction(formData: FormData): Promise<void> {
  const { actor, tenant } = await manager();
  const id = z.uuid().parse(formData.get("id"));
  const blocked = formData.get("blocked") === "1";
  await tenant((tx) => setDoNotContact(tx, actor, id, blocked));
  revalidateCustomers(id);
}

export async function deleteProspectAction(formData: FormData): Promise<void> {
  const { actor, tenant } = await manager();
  const id = z.uuid().parse(formData.get("id"));
  const deleted = await tenant((tx) => deleteProspect(tx, actor, id));
  // Issued invoices are kept (§ 132 BAO); the page explains why the customer stays.
  if (deleted === "retained") redirect(`/kunden/${id}#stammdaten`);
  revalidateCustomers();
  redirect("/kunden");
}

/**
 * Deletion request for a customer with issued invoices (Sperrvermerk, §7.10):
 * deletes all but the records that must be kept, see `restrictProspect`.
 */
export async function restrictProspectAction(formData: FormData): Promise<void> {
  const { actor, tenant } = await manager();
  const id = z.uuid().parse(formData.get("id"));
  const result = await tenant(async (tx) => {
    const restricted = await restrictProspect(tx, actor, id);
    if (restricted !== "deletable") return restricted ? "restricted" : "missing";
    return (await deleteProspect(tx, actor, id)) === true ? "deleted" : "missing";
  });
  revalidateCustomers(id);
  if (result === "restricted") redirect(`/kunden/${id}#${PROSPECT_ANCHORS.privacy}`);
  redirect("/kunden");
}

export async function addContactAction(_: FormState, formData: FormData): Promise<FormState> {
  const { actor, tenant } = await manager();
  const prospectId = z.uuid().safeParse(formData.get("prospectId"));
  const parsed = contactFormSchema.safeParse(Object.fromEntries(formData));
  if (!prospectId.success) return { ok: false, message: "Kunde nicht gefunden." };
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  if (!parsed.data.firstName && !parsed.data.lastName && !parsed.data.role) {
    return {
      ok: false,
      errors: { lastName: "Bitte mindestens einen Namen oder eine Rolle angeben." },
    };
  }
  const added = await tenant((tx) => addContact(tx, actor, prospectId.data, parsed.data));
  if (!added) return { ok: false, message: "Kunde nicht gefunden oder gesperrt." };
  revalidateCustomers(prospectId.data);
  return { ok: true, message: "Ansprechpartner hinzugefügt." };
}

export async function removeContactAction(formData: FormData): Promise<void> {
  const { actor, tenant } = await manager();
  const id = z.uuid().parse(formData.get("id"));
  const prospectId = z.uuid().parse(formData.get("prospectId"));
  await tenant((tx) => removeContact(tx, actor, id));
  revalidateCustomers(prospectId);
}

export async function addTouchpointAction(_: FormState, formData: FormData): Promise<FormState> {
  const { actor, tenant } = await manager();
  const prospectId = z.uuid().safeParse(formData.get("prospectId"));
  if (!prospectId.success) return { ok: false, message: "Kunde nicht gefunden." };
  const label = String(formData.get("label") ?? "")
    .trim()
    .slice(0, 80);
  if (!label) return { ok: false, errors: { label: "Bitte eine Bezeichnung angeben." } };
  const rawCode = String(formData.get("shortCode") ?? "");
  let shortCode: string | undefined;
  if (rawCode.trim()) {
    shortCode = normalizeShortCode(rawCode);
    const problem = checkShortCode(shortCode);
    if (problem) {
      return {
        ok: false,
        errors: {
          shortCode:
            problem === "reserved"
              ? "Dieser Kurzlink ist für das System reserviert."
              : "3 bis 40 Zeichen: Buchstaben, Ziffern und Bindestriche.",
        },
      };
    }
  }
  const result = await tenant((tx) =>
    addTouchpoint(tx, actor, { prospectId: prospectId.data, label, shortCode }),
  );
  if (!result.ok) {
    return result.error === "code_taken"
      ? { ok: false, errors: { shortCode: `„${shortCode}“ ist schon vergeben.` } }
      : { ok: false, message: "Für diesen Kunden gibt es noch kein Exposé." };
  }
  revalidateCustomers(prospectId.data);
  return { ok: true, message: `Link „${label}“ angelegt.` };
}

export async function toggleTouchpointAction(formData: FormData): Promise<void> {
  const { actor, tenant } = await manager();
  const id = z.uuid().parse(formData.get("id"));
  const enabled = formData.get("enabled") === "1";
  const prospectId = await tenant((tx) => setTouchpointEnabled(tx, actor, id, enabled));
  if (prospectId) revalidateCustomers(prospectId);
}

export async function saveViewAction(_: FormState, formData: FormData): Promise<FormState> {
  const { actor, tenant } = await manager();
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 60);
  if (!name) return { ok: false, errors: { name: "Bitte einen Namen angeben." } };
  const query = canonicalViewQuery(String(formData.get("query") ?? "").slice(0, 500));
  await tenant((tx) =>
    saveView(tx, actor, { name, query, shared: formData.get("shared") === "1" }),
  );
  revalidatePath("/kunden");
  return { ok: true, message: `Ansicht „${name}“ gespeichert.` };
}

export async function deleteViewAction(formData: FormData): Promise<void> {
  const { actor, tenant } = await manager();
  const id = z.uuid().parse(formData.get("id"));
  await tenant((tx) => deleteView(tx, actor, id));
  revalidatePath("/kunden");
}
