"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { INVOICE_SEND_MODES } from "@/domain/invoices/email";
import {
  createContractsFromOffer,
  saveContract,
  setContractEnd,
  type ContractResult,
} from "@/server/invoices/contracts";
import { requireCockpit } from "@/server/session";

/** Cockpit side of maintenance contracts (§7.10, phase 7c-3). */

export interface ContractActionState {
  ok: boolean;
  message?: string;
}

async function manager() {
  const context = await requireCockpit();
  assertCan(context.actor, "prospects.manage", { workspaceId: context.workspace.id });
  return context;
}

const id = z.uuid();
const optionalDate = z.union([z.iso.date(), z.literal("").transform(() => null)]);
const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function failure(result: Exclude<ContractResult, { ok: true }>): ContractActionState {
  return {
    ok: false,
    message:
      result.message ??
      (result.error === "not_found" ? "Vertrag nicht gefunden." : "Bitte prüfen Sie die Angaben."),
  };
}

export async function createContractsAction(offerId: string): Promise<ContractActionState> {
  const { actor, tenant } = await manager();
  const parsed = id.safeParse(offerId);
  if (!parsed.success) return { ok: false, message: "Angebot nicht gefunden." };
  const result = await tenant((tx) => createContractsFromOffer(tx, actor, parsed.data));
  if ("error" in result) {
    return {
      ok: false,
      message:
        result.error === "not_accepted"
          ? "Wartungsverträge entstehen erst aus einem angenommenen Angebot."
          : result.error === "nothing_left"
            ? "Für alle wiederkehrenden Positionen gibt es schon einen Vertrag."
            : "Angebot nicht gefunden.",
    };
  }
  revalidatePath(`/angebote/${parsed.data}`);
  revalidatePath("/rechnungen/vertraege");
  return {
    ok: true,
    message:
      result.created === 1
        ? "Wartungsvertrag angelegt."
        : `${result.created} Wartungsverträge angelegt.`,
  };
}

const settingsSchema = z.object({
  startDate: optionalDate,
  sendMode: z.union([z.enum(INVOICE_SEND_MODES), z.literal("").transform(() => null)]),
});

export async function saveContractAction(
  _previous: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const { actor, tenant } = await manager();
  const contractId = id.safeParse(text(formData, "contractId"));
  const parsed = settingsSchema.safeParse({
    startDate: text(formData, "startDate"),
    sendMode: text(formData, "sendMode"),
  });
  if (!contractId.success || !parsed.success) {
    return { ok: false, message: "Bitte prüfen Sie die Angaben." };
  }
  const result = await tenant((tx) => saveContract(tx, actor, contractId.data, parsed.data));
  if (!result.ok) return failure(result);
  revalidatePath(`/rechnungen/vertraege/${contractId.data}`);
  return { ok: true, message: "Gespeichert." };
}

export async function setContractEndAction(
  _previous: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const { actor, tenant } = await manager();
  const contractId = id.safeParse(text(formData, "contractId"));
  const withdraw = text(formData, "intent") === "withdraw";
  const parsed = z.object({ noticeReceivedOn: z.iso.date(), endDate: optionalDate }).safeParse({
    noticeReceivedOn: text(formData, "noticeReceivedOn"),
    endDate: text(formData, "endDate"),
  });
  if (!contractId.success || (!withdraw && !parsed.success)) {
    return { ok: false, message: "Bitte das Datum der Kündigung angeben." };
  }
  const input = withdraw
    ? { noticeReceivedOn: null, endDate: null }
    : { noticeReceivedOn: parsed.data!.noticeReceivedOn, endDate: parsed.data!.endDate };
  const result = await tenant((tx) => setContractEnd(tx, actor, contractId.data, input));
  if (!result.ok) return failure(result);
  revalidatePath(`/rechnungen/vertraege/${contractId.data}`);
  revalidatePath("/rechnungen/vertraege");
  return {
    ok: true,
    message: withdraw
      ? "Kündigung zurückgenommen."
      : `Kündigung eingetragen. Der Vertrag endet am ${result.endDate!.split("-").reverse().join(".")}.`,
  };
}
