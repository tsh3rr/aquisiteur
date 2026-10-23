import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Transaction } from "@/db";
import { auditLog, contractTimeEntries, maintenanceContracts } from "@/db/schema";
import type { Actor } from "@/domain/authz";
import {
  includedForSpan,
  overageLine,
  overagePeriod,
  usedMinutes,
} from "@/domain/invoices/hour-quota";
import { calendarPeriod, type ContractInterval } from "@/domain/invoices/maintenance";
import type { InvoiceLine } from "@/domain/invoices/schema";

/**
 * Stundenkontingent of maintenance contracts (§7.10, phase 7c-3b, ADR-0075):
 * work is logged against the contract and billed beyond the quota with the
 * next invoice. Entries up to `overage_billed_until` are billed and locked.
 */

type ContractRow = typeof maintenanceContracts.$inferSelect;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type TimeEntryResult =
  { ok: true } | { ok: false; error: "not_found" | "locked" | "invalid"; message?: string };

async function lockContract(tx: Transaction, workspaceId: string, contractId: string) {
  const [contract] = await tx
    .select()
    .from(maintenanceContracts)
    .where(
      and(
        eq(maintenanceContracts.workspaceId, workspaceId),
        eq(maintenanceContracts.id, contractId),
      ),
    )
    .for("update");
  return contract ?? null;
}

export async function listTimeEntries(tx: Transaction, workspaceId: string, contractId: string) {
  return tx
    .select()
    .from(contractTimeEntries)
    .where(
      and(
        eq(contractTimeEntries.workspaceId, workspaceId),
        eq(contractTimeEntries.contractId, contractId),
      ),
    )
    .orderBy(desc(contractTimeEntries.workDate), desc(contractTimeEntries.createdAt))
    .limit(500);
}

/** Quota and hourly rate; null rate: extra hours are not billed. */
export async function saveQuota(
  tx: Transaction,
  actor: Actor,
  contractId: string,
  input: { includedMinutes: number; hourlyRateCents: number | null },
): Promise<TimeEntryResult> {
  if (
    !Number.isInteger(input.includedMinutes) ||
    input.includedMinutes < 0 ||
    input.includedMinutes > 12_000
  ) {
    return { ok: false, error: "invalid", message: "Bitte höchstens 200 Stunden angeben." };
  }
  if (
    input.hourlyRateCents !== null &&
    (!Number.isInteger(input.hourlyRateCents) ||
      input.hourlyRateCents <= 0 ||
      input.hourlyRateCents > 10_000_000)
  ) {
    return { ok: false, error: "invalid", message: "Bitte einen gültigen Stundensatz angeben." };
  }
  const contract = await lockContract(tx, actor.workspaceId, contractId);
  if (!contract) return { ok: false, error: "not_found" };
  await tx
    .update(maintenanceContracts)
    .set({ includedMinutes: input.includedMinutes, hourlyRateCents: input.hourlyRateCents })
    .where(eq(maintenanceContracts.id, contractId));
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "contract.quota_updated",
    targetType: "prospect",
    targetId: contract.prospectId,
    meta: { contractId, ...input },
  });
  return { ok: true };
}

function lockedUntil(contract: ContractRow): string | null {
  return contract.overageBilledUntil;
}

export async function addTimeEntry(
  tx: Transaction,
  actor: Actor,
  contractId: string,
  input: { workDate: string; minutes: number; description: string },
): Promise<TimeEntryResult> {
  const description = input.description.trim();
  if (!ISO_DATE.test(input.workDate)) {
    return { ok: false, error: "invalid", message: "Bitte ein gültiges Datum angeben." };
  }
  if (!Number.isInteger(input.minutes) || input.minutes <= 0 || input.minutes > 24 * 60) {
    return { ok: false, error: "invalid", message: "Bitte eine Dauer bis 24 Stunden angeben." };
  }
  if (description.length < 2 || description.length > 200) {
    return {
      ok: false,
      error: "invalid",
      message: "Bitte kurz beschreiben, was gemacht wurde (bis 200 Zeichen).",
    };
  }
  const contract = await lockContract(tx, actor.workspaceId, contractId);
  if (!contract) return { ok: false, error: "not_found" };
  if (!contract.startDate || input.workDate < contract.startDate) {
    return { ok: false, error: "invalid", message: "Das Datum liegt vor dem Vertragsbeginn." };
  }
  if (contract.endDate && input.workDate > contract.endDate) {
    return { ok: false, error: "invalid", message: "Das Datum liegt nach dem Vertragsende." };
  }
  const locked = lockedUntil(contract);
  if (locked && input.workDate <= locked) {
    return {
      ok: false,
      error: "locked",
      message: "Bis dahin sind die Stunden schon abgerechnet.",
    };
  }
  await tx.insert(contractTimeEntries).values({
    workspaceId: actor.workspaceId,
    contractId,
    workDate: input.workDate,
    minutes: input.minutes,
    description,
    createdBy: actor.userId,
  });
  return { ok: true };
}

export async function deleteTimeEntry(
  tx: Transaction,
  actor: Actor,
  contractId: string,
  entryId: string,
): Promise<TimeEntryResult> {
  const contract = await lockContract(tx, actor.workspaceId, contractId);
  if (!contract) return { ok: false, error: "not_found" };
  const [entry] = await tx
    .select()
    .from(contractTimeEntries)
    .where(
      and(
        eq(contractTimeEntries.workspaceId, actor.workspaceId),
        eq(contractTimeEntries.contractId, contractId),
        eq(contractTimeEntries.id, entryId),
      ),
    );
  if (!entry) return { ok: false, error: "not_found" };
  const locked = lockedUntil(contract);
  if (locked && entry.workDate <= locked) {
    return { ok: false, error: "locked", message: "Dieser Eintrag ist schon abgerechnet." };
  }
  await tx.delete(contractTimeEntries).where(eq(contractTimeEntries.id, entryId));
  return { ok: true };
}

async function entriesIn(
  tx: Transaction,
  contract: ContractRow,
  span: { from: string; to: string },
) {
  return tx
    .select({
      workDate: contractTimeEntries.workDate,
      minutes: contractTimeEntries.minutes,
      description: contractTimeEntries.description,
    })
    .from(contractTimeEntries)
    .where(
      and(
        eq(contractTimeEntries.workspaceId, contract.workspaceId),
        eq(contractTimeEntries.contractId, contract.id),
        gte(contractTimeEntries.workDate, span.from),
        lte(contractTimeEntries.workDate, span.to),
      ),
    );
}

/**
 * The extra hours the invoice for `period` carries, and the span they
 * cover; null when the contract bills no extra hours or none are due.
 */
export async function overageFor(
  tx: Transaction,
  contract: ContractRow,
  period: { from: string; to: string },
): Promise<{ line: InvoiceLine | null; span: { from: string; to: string } } | null> {
  if (!contract.hourlyRateCents) return null;
  const interval = contract.interval as ContractInterval;
  const span = overagePeriod(
    { interval, timing: contract.timing, startDate: contract.startDate },
    period,
    contract.overageBilledUntil,
  );
  if (!span) return null;
  const entries = await entriesIn(tx, contract, span);
  return {
    line: overageLine({
      entries,
      includedMinutes: includedForSpan(interval, span, contract.includedMinutes),
      hourlyRateCents: contract.hourlyRateCents,
      span,
      vatRate: contract.lines[0]?.vatRate ?? 20,
    }),
    span,
  };
}

/** Hours of the calendar period around `today`, for the contract page. */
export async function currentUsage(tx: Transaction, contract: ContractRow, today: string) {
  if (!contract.startDate || today < contract.startDate) return null;
  const interval = contract.interval as ContractInterval;
  const calendar = calendarPeriod(interval, today);
  const span = {
    from: calendar.from < contract.startDate ? contract.startDate : calendar.from,
    to: contract.endDate && calendar.to > contract.endDate ? contract.endDate : calendar.to,
  };
  const entries = await entriesIn(tx, contract, span);
  return {
    span,
    usedMinutes: usedMinutes(entries),
    includedMinutes: includedForSpan(interval, span, contract.includedMinutes),
  };
}
