"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { INVOICE_SEND_MODES } from "@/domain/invoices/email";
import { formatHours, parseDuration } from "@/domain/invoices/hour-quota";
import { parseIndex } from "@/domain/invoices/indexation";
import { germanDate } from "@/domain/invoices/totals";
import { parseEuroInput } from "@/domain/offers/totals";
import {
  createContractsFromOffer,
  saveContract,
  setContractEnd,
  type ContractResult,
} from "@/server/invoices/contracts";
import {
  announceAdjustment,
  saveIndexation,
  withdrawAdjustment,
} from "@/server/invoices/indexation";
import { addTimeEntry, deleteTimeEntry, saveQuota } from "@/server/invoices/time-entries";
import { requireCockpit } from "@/server/session";

/** Cockpit side of maintenance contracts (§7.10, phases 7c-3 and 7c-3b). */

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

function failure(
  result: Exclude<ContractResult, { ok: true }> | { ok: false; error: string; message?: string },
): ContractActionState {
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

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function revalidateContract(contractId: string) {
  revalidatePath(`/rechnungen/vertraege/${contractId}`);
}

export async function saveIndexationAction(
  _previous: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const { actor, tenant } = await manager();
  const contractId = id.safeParse(text(formData, "contractId"));
  if (!contractId.success) return { ok: false, message: "Vertrag nicht gefunden." };
  const baseMonth = text(formData, "baseMonth").trim();
  const baseRaw = text(formData, "baseValue").trim();
  const baseTenths = baseRaw ? parseIndex(baseRaw) : null;
  if (baseRaw && baseTenths === null) {
    return {
      ok: false,
      message: "Bitte den Indexwert mit höchstens einer Nachkommastelle angeben.",
    };
  }
  if (baseMonth && !MONTH.test(baseMonth)) {
    return { ok: false, message: "Bitte den Basismonat als JJJJ-MM angeben." };
  }
  const result = await tenant((tx) =>
    saveIndexation(tx, actor, contractId.data, {
      indexed: formData.get("indexed") === "on",
      indexMonth: Number(text(formData, "indexMonth")),
      baseMonth: baseMonth || null,
      baseTenths,
      thresholdPercent: Number(text(formData, "thresholdPercent") || "0"),
    }),
  );
  if (!result.ok) return failure(result);
  revalidateContract(contractId.data);
  return { ok: true, message: "Gespeichert." };
}

export async function announceAdjustmentAction(
  _previous: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const { actor, tenant } = await manager();
  const contractId = id.safeParse(text(formData, "contractId"));
  if (!contractId.success) return { ok: false, message: "Vertrag nicht gefunden." };
  const indexMonth = text(formData, "indexMonth").trim();
  const indexTenths = parseIndex(text(formData, "indexValue"));
  if (!MONTH.test(indexMonth) || indexTenths === null) {
    return { ok: false, message: "Bitte Monat (JJJJ-MM) und Wert des Index angeben." };
  }
  const result = await announceAdjustment(tenant, actor, {
    contractId: contractId.data,
    indexMonth,
    indexTenths,
    to: text(formData, "to").trim(),
    subject: text(formData, "subject").slice(0, 200),
    body: text(formData, "body").slice(0, 4000),
  });
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.message ??
        (result.error === "send_failed"
          ? "Die E-Mail konnte nicht gesendet werden. Es wurde nichts angekündigt; bitte erneut versuchen."
          : result.error === "restricted"
            ? "Für diesen Kunden gilt ein Sperrvermerk."
            : "Vertrag nicht gefunden."),
    };
  }
  revalidateContract(contractId.data);
  return {
    ok: true,
    message:
      result.status === "skipped"
        ? "Festgehalten: keine Anpassung, die Änderung liegt im Schwellenwert."
        : `Angekündigt und gesendet. Die neuen Preise gelten ab ${germanDate(result.effectiveFrom!)}.`,
  };
}

export async function withdrawAdjustmentAction(
  contractId: string,
  adjustmentId: string,
): Promise<ContractActionState> {
  const { actor, tenant } = await manager();
  const ids = z
    .object({ contractId: id, adjustmentId: id })
    .safeParse({ contractId, adjustmentId });
  if (!ids.success) return { ok: false, message: "Anpassung nicht gefunden." };
  const result = await tenant((tx) =>
    withdrawAdjustment(tx, actor, ids.data.contractId, ids.data.adjustmentId),
  );
  if (!result.ok) return failure(result);
  revalidateContract(ids.data.contractId);
  return { ok: true, message: "Zurückgezogen. Bitte informieren Sie den Kunden." };
}

export async function saveQuotaAction(
  _previous: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const { actor, tenant } = await manager();
  const contractId = id.safeParse(text(formData, "contractId"));
  if (!contractId.success) return { ok: false, message: "Vertrag nicht gefunden." };
  const hoursRaw = text(formData, "includedHours").trim();
  const included = !hoursRaw || /^0+([.,]0+)?$/.test(hoursRaw) ? 0 : parseDuration(hoursRaw);
  if (included === null) return { ok: false, message: "Bitte die Stunden als Zahl angeben." };
  const rateRaw = text(formData, "hourlyRate").trim();
  const rate = rateRaw ? parseEuroInput(rateRaw) : null;
  if (rateRaw && rate === null)
    return { ok: false, message: "Bitte einen gültigen Stundensatz angeben." };
  const result = await tenant((tx) =>
    saveQuota(tx, actor, contractId.data, { includedMinutes: included, hourlyRateCents: rate }),
  );
  if (!result.ok) return failure(result);
  revalidateContract(contractId.data);
  return { ok: true, message: "Gespeichert." };
}

export async function addTimeEntryAction(
  _previous: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const { actor, tenant } = await manager();
  const contractId = id.safeParse(text(formData, "contractId"));
  if (!contractId.success) return { ok: false, message: "Vertrag nicht gefunden." };
  const minutes = parseDuration(text(formData, "duration"));
  if (minutes === null) {
    return { ok: false, message: "Bitte die Dauer angeben, z. B. 1,5 oder 1:30." };
  }
  const result = await tenant((tx) =>
    addTimeEntry(tx, actor, contractId.data, {
      workDate: text(formData, "workDate"),
      minutes,
      description: text(formData, "description"),
    }),
  );
  if (!result.ok) return failure(result);
  revalidateContract(contractId.data);
  return { ok: true, message: `${formatHours(minutes)} erfasst.` };
}

export async function deleteTimeEntryAction(
  contractId: string,
  entryId: string,
): Promise<ContractActionState> {
  const { actor, tenant } = await manager();
  const ids = z.object({ contractId: id, entryId: id }).safeParse({ contractId, entryId });
  if (!ids.success) return { ok: false, message: "Eintrag nicht gefunden." };
  const result = await tenant((tx) =>
    deleteTimeEntry(tx, actor, ids.data.contractId, ids.data.entryId),
  );
  if (!result.ok) return failure(result);
  revalidateContract(ids.data.contractId);
  return { ok: true, message: "Eintrag gelöscht." };
}
