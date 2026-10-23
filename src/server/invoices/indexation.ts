import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, gte, sql } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import { withTenant, type Database, type Transaction } from "@/db";
import {
  auditLog,
  contractAdjustments,
  maintenanceContracts,
  outboundEmails,
  prospects,
  tasks,
  workspaces,
} from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { domainOf, messageIdFor, senderAddress } from "@/domain/email";
import { fillTemplate, mailFromText } from "@/domain/invoices/email";
import {
  indexEmailValues,
  monthLabel,
  nextCycle,
  planAdjustment,
  type AdjustmentPlan,
} from "@/domain/invoices/indexation";
import type { ContractInterval } from "@/domain/invoices/maintenance";
import type { InvoiceLine } from "@/domain/invoices/schema";
import { addDays, localDateString } from "@/domain/tasks";
import { loadWorkspaceSettings, workspaceOwner } from "@/server/workspaces";
import { loadProspect } from "./manage";
import { defaultRecipient, replyToAddress, senderName, transmitMail } from "./send";

/**
 * Wertsicherung of maintenance contracts (§7.10, phase 7c-3b, ADR-0075). The
 * owner enters the published VPI value; inside the threshold the cycle is
 * recorded as „keine Anpassung“, otherwise the customer gets the new prices
 * by mail and the first invoice from the effective day applies them.
 */

type Tenant = <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
type ContractRow = typeof maintenanceContracts.$inferSelect;
export type AdjustmentRow = typeof contractAdjustments.$inferSelect;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type IndexationResult =
  { ok: true } | { ok: false; error: "not_found" | "locked" | "invalid"; message?: string };

export async function listAdjustments(tx: Transaction, workspaceId: string, contractId: string) {
  return tx
    .select()
    .from(contractAdjustments)
    .where(
      and(
        eq(contractAdjustments.workspaceId, workspaceId),
        eq(contractAdjustments.contractId, contractId),
      ),
    )
    .orderBy(desc(contractAdjustments.dueOn), desc(contractAdjustments.createdAt));
}

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

function pending(adjustments: AdjustmentRow[]) {
  return adjustments.find((adjustment) => adjustment.status === "announced") ?? null;
}

/** Indexation on or off, index month, base and threshold. The base is fixed while a change is announced. */
export async function saveIndexation(
  tx: Transaction,
  actor: Actor,
  contractId: string,
  input: {
    indexed: boolean;
    indexMonth: number;
    baseMonth: string | null;
    baseTenths: number | null;
    thresholdPercent: number;
  },
): Promise<IndexationResult> {
  if (!Number.isInteger(input.indexMonth) || input.indexMonth < 1 || input.indexMonth > 12) {
    return { ok: false, error: "invalid", message: "Bitte einen Monat wählen." };
  }
  if (
    !Number.isInteger(input.thresholdPercent) ||
    input.thresholdPercent < 0 ||
    input.thresholdPercent > 10
  ) {
    return { ok: false, error: "invalid", message: "Der Schwellenwert liegt zwischen 0 und 10 %." };
  }
  if ((input.baseMonth === null) !== (input.baseTenths === null)) {
    return { ok: false, error: "invalid", message: "Bitte Monat und Wert der Basis angeben." };
  }
  if (input.baseMonth !== null && !MONTH.test(input.baseMonth)) {
    return { ok: false, error: "invalid", message: "Bitte einen gültigen Basismonat angeben." };
  }
  if (input.indexed && input.baseTenths === null) {
    return {
      ok: false,
      error: "invalid",
      message: "Für die Wertsicherung braucht es den Ausgangswert (Basis).",
    };
  }
  const contract = await lockContract(tx, actor.workspaceId, contractId);
  if (!contract) return { ok: false, error: "not_found" };
  const adjustments = await listAdjustments(tx, actor.workspaceId, contractId);
  const baseChanged =
    input.baseMonth !== contract.indexBaseMonth || input.baseTenths !== contract.indexBaseTenths;
  if (!input.indexed && pending(adjustments)) {
    return {
      ok: false,
      error: "locked",
      message: "Bitte zuerst die angekündigte Anpassung zurückziehen.",
    };
  }
  if (baseChanged && pending(adjustments)) {
    return {
      ok: false,
      error: "locked",
      message: "Solange eine Anpassung angekündigt ist, bleibt die Basis fest.",
    };
  }
  await tx
    .update(maintenanceContracts)
    .set({
      indexed: input.indexed,
      indexMonth: input.indexMonth,
      indexBaseMonth: input.baseMonth,
      indexBaseTenths: input.baseTenths,
      indexThresholdPercent: input.thresholdPercent,
    })
    .where(eq(maintenanceContracts.id, contractId));
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "contract.indexation_updated",
    targetType: "prospect",
    targetId: contract.prospectId,
    meta: { contractId, ...input },
  });
  return { ok: true };
}

interface Draft {
  contract: ContractRow;
  dueOn: string;
  today: string;
  plan: AdjustmentPlan;
  noticeDays: number;
}

async function draftAdjustment(
  tx: Transaction,
  workspaceId: string,
  contract: ContractRow,
  index: { month: string; tenths: number },
  now: Date,
): Promise<Draft | { error: string }> {
  if (!contract.indexed || !contract.indexBaseMonth || !contract.indexBaseTenths) {
    return { error: "Die Wertsicherung ist für diesen Vertrag nicht eingerichtet." };
  }
  if (!MONTH.test(index.month) || index.month <= contract.indexBaseMonth) {
    return {
      error: `Der Indexmonat muss nach dem Basismonat ${monthLabel(contract.indexBaseMonth)} liegen.`,
    };
  }
  if (!Number.isInteger(index.tenths) || index.tenths <= 0) {
    return { error: "Bitte einen gültigen Indexwert angeben." };
  }
  const adjustments = await listAdjustments(tx, workspaceId, contract.id);
  if (pending(adjustments)) {
    return { error: "Es ist schon eine Anpassung angekündigt." };
  }
  const dueOn = nextCycle(contract, adjustments);
  if (!dueOn) return { error: "Für diesen Vertrag steht keine Anpassung an." };
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  const today = localDateString(now, settings.notifications.timezone);
  const noticeDays = settings.billing.indexNoticeDays;
  const plan = planAdjustment({
    lines: contract.lines,
    interval: contract.interval as ContractInterval,
    baseTenths: contract.indexBaseTenths,
    indexTenths: index.tenths,
    thresholdPercent: contract.indexThresholdPercent,
    dueOn,
    today,
    noticeDays,
    billedUntil: contract.billedUntil,
  });
  return { contract, dueOn, today, plan, noticeDays };
}

async function closeIndexTasks(
  tx: Transaction,
  workspaceId: string,
  contractId: string,
  now: Date,
) {
  await tx
    .update(tasks)
    .set({ doneAt: now })
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.contractId, contractId),
        isNull(tasks.doneAt),
      ),
    );
}

export type AnnounceResult =
  | { ok: true; status: "skipped" | "announced"; effectiveFrom: string | null }
  | {
      ok: false;
      error: "not_found" | "restricted" | "invalid" | "send_failed";
      message?: string;
    };

/**
 * Records the index value for the contract's next cycle. Inside the
 * threshold nothing is sent; otherwise the announcement goes to `to` and
 * counts only once the provider has it.
 */
export async function announceAdjustment(
  tenant: Tenant,
  actor: Actor,
  input: {
    contractId: string;
    indexMonth: string;
    indexTenths: number;
    to: string;
    subject: string;
    body: string;
  },
  now = new Date(),
): Promise<AnnounceResult> {
  const env = serverEnv();
  const prepared = await tenant(async (tx) => {
    const contract = await lockContract(tx, actor.workspaceId, input.contractId);
    if (!contract) return { ok: false as const, error: "not_found" as const };
    const prospect = await loadProspect(tx, actor.workspaceId, contract.prospectId);
    if (!prospect) return { ok: false as const, error: "not_found" as const };
    if (prospect.restrictedAt) return { ok: false as const, error: "restricted" as const };
    const draft = await draftAdjustment(
      tx,
      actor.workspaceId,
      contract,
      { month: input.indexMonth, tenths: input.indexTenths },
      now,
    );
    if ("error" in draft) {
      return { ok: false as const, error: "invalid" as const, message: draft.error };
    }
    const { plan } = draft;
    const row = {
      workspaceId: actor.workspaceId,
      contractId: contract.id,
      dueOn: draft.dueOn,
      baseMonth: contract.indexBaseMonth!,
      baseTenths: contract.indexBaseTenths!,
      indexMonth: input.indexMonth,
      indexTenths: input.indexTenths,
      changeBp: Math.round(plan.changePercent * 100),
      oldLines: contract.lines,
      newLines: plan.newLines,
      createdBy: actor.userId,
    };
    if (plan.within) {
      await tx.insert(contractAdjustments).values({ ...row, status: "skipped" });
      await closeIndexTasks(tx, actor.workspaceId, contract.id, now);
      await tx.insert(auditLog).values({
        workspaceId: actor.workspaceId,
        actorUserId: actor.userId,
        action: "contract.index_skipped",
        targetType: "prospect",
        targetId: contract.prospectId,
        meta: { contractId: contract.id, dueOn: draft.dueOn, changeBp: row.changeBp },
      });
      return { ok: true as const, skipped: true as const };
    }
    if (!input.to.includes("@")) {
      return {
        ok: false as const,
        error: "invalid" as const,
        message: "Bitte eine E-Mail-Adresse angeben.",
      };
    }
    const [workspace] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, actor.workspaceId));
    const settings = await loadWorkspaceSettings(tx, actor.workspaceId);
    const sender = senderName(settings, workspace?.name ?? "");
    const values = indexEmailValues({
      contractTitle: contract.title,
      interval: contract.interval as ContractInterval,
      baseMonth: row.baseMonth,
      baseTenths: row.baseTenths,
      indexMonth: input.indexMonth,
      indexTenths: input.indexTenths,
      effectiveFrom: plan.effectiveFrom,
      oldLines: contract.lines,
      newLines: plan.newLines,
      sender,
    });
    const mail = mailFromText({
      subject: fillTemplate(input.subject, values),
      text: fillTemplate(input.body, values),
    });
    const [adjustment] = await tx
      .insert(contractAdjustments)
      .values({
        ...row,
        status: "announced",
        effectiveFrom: plan.effectiveFrom,
        announcedAt: now,
      })
      .returning({ id: contractAdjustments.id });
    const id = crypto.randomUUID();
    const domain = domainOf(env.EMAIL_FROM) ?? new URL(env.APP_URL).hostname;
    const messageId = messageIdFor(id, domain);
    await tx.insert(outboundEmails).values({
      id,
      workspaceId: actor.workspaceId,
      kind: "contract_notice",
      prospectId: contract.prospectId,
      projectId: contract.projectId,
      contractId: contract.id,
      toAddress: input.to,
      subject: mail.subject,
      messageId,
      status: "sending",
      statusAt: now,
      sentBy: actor.userId,
      createdAt: now,
    });
    return {
      ok: true as const,
      skipped: false as const,
      adjustmentId: adjustment!.id,
      effectiveFrom: plan.effectiveFrom,
      prospectId: contract.prospectId,
      dueOn: draft.dueOn,
      changeBp: row.changeBp,
      mail: {
        id,
        messageId,
        to: input.to,
        from: senderAddress(sender, env.EMAIL_FROM),
        replyTo: await replyToAddress(tx, actor.workspaceId, settings),
        mail,
        pdfKey: null,
        number: contract.title,
      },
    };
  });
  if (!prepared.ok) return prepared;
  if (prepared.skipped) return { ok: true, status: "skipped", effectiveFrom: null };

  const sent = await transmitMail(tenant, actor.workspaceId, prepared.mail);
  // Not announced unless the customer was told: the cycle stays open for another try.
  await tenant(async (tx) => {
    if (!sent.ok) {
      await tx
        .update(contractAdjustments)
        .set({ status: "withdrawn" })
        .where(
          and(
            eq(contractAdjustments.workspaceId, actor.workspaceId),
            eq(contractAdjustments.id, prepared.adjustmentId),
            eq(contractAdjustments.status, "announced"),
          ),
        );
      return;
    }
    await closeIndexTasks(tx, actor.workspaceId, input.contractId, now);
    await tx.insert(auditLog).values({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: "contract.index_announced",
      targetType: "prospect",
      targetId: prepared.prospectId,
      meta: {
        contractId: input.contractId,
        dueOn: prepared.dueOn,
        effectiveFrom: prepared.effectiveFrom,
        changeBp: prepared.changeBp,
      },
    });
  });
  if (!sent.ok) return { ok: false, error: "send_failed" };
  return { ok: true, status: "announced", effectiveFrom: prepared.effectiveFrom };
}

/** Takes back an announced change before an invoice applied it; the cycle is open again. */
export async function withdrawAdjustment(
  tx: Transaction,
  actor: Actor,
  contractId: string,
  adjustmentId: string,
): Promise<IndexationResult> {
  const contract = await lockContract(tx, actor.workspaceId, contractId);
  if (!contract) return { ok: false, error: "not_found" };
  const [withdrawn] = await tx
    .update(contractAdjustments)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(contractAdjustments.workspaceId, actor.workspaceId),
        eq(contractAdjustments.contractId, contractId),
        eq(contractAdjustments.id, adjustmentId),
        eq(contractAdjustments.status, "announced"),
      ),
    )
    .returning({ dueOn: contractAdjustments.dueOn });
  if (!withdrawn) {
    return { ok: false, error: "locked", message: "Diese Anpassung ist schon angewendet." };
  }
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "contract.index_withdrawn",
    targetType: "prospect",
    targetId: contract.prospectId,
    meta: { contractId, adjustmentId, dueOn: withdrawn.dueOn },
  });
  return { ok: true };
}

/**
 * Called by billing under the contract's lock: every announced change that
 * is effective for the period becomes the contract's price and new base.
 */
export async function applyDueAdjustments(
  tx: Transaction,
  contract: ContractRow,
  periodFrom: string,
  now: Date,
): Promise<InvoiceLine[]> {
  const due = await tx
    .select()
    .from(contractAdjustments)
    .where(
      and(
        eq(contractAdjustments.workspaceId, contract.workspaceId),
        eq(contractAdjustments.contractId, contract.id),
        eq(contractAdjustments.status, "announced"),
        lte(contractAdjustments.effectiveFrom, periodFrom),
      ),
    )
    .orderBy(asc(contractAdjustments.effectiveFrom));
  if (due.length === 0) return contract.lines;
  const last = due.at(-1)!;
  await tx
    .update(contractAdjustments)
    .set({ status: "applied", appliedAt: now })
    .where(
      and(
        eq(contractAdjustments.workspaceId, contract.workspaceId),
        inArray(
          contractAdjustments.id,
          due.map((adjustment) => adjustment.id),
        ),
      ),
    );
  await tx
    .update(maintenanceContracts)
    .set({
      lines: last.newLines,
      indexBaseMonth: last.indexMonth,
      indexBaseTenths: last.indexTenths,
    })
    .where(eq(maintenanceContracts.id, contract.id));
  return last.newLines;
}

/** The mail the announce form starts from. */
export async function announcementDraft(tx: Transaction, workspaceId: string, prospectId: string) {
  const prospect = await loadProspect(tx, workspaceId, prospectId);
  return { to: prospect ? await defaultRecipient(tx, prospect) : "" };
}

/**
 * Hourly job: a „Wertsicherung prüfen“ task two weeks before the notice
 * must go out, once per cycle (system connection to find the contracts,
 * withTenant as the owner to write).
 */
export async function runIndexReminders(db: Database, now = new Date()) {
  const candidates = await db
    .select({ contract: maintenanceContracts })
    .from(maintenanceContracts)
    .innerJoin(
      prospects,
      and(
        eq(prospects.workspaceId, maintenanceContracts.workspaceId),
        eq(prospects.id, maintenanceContracts.prospectId),
      ),
    )
    .where(
      and(
        eq(maintenanceContracts.indexed, true),
        isNotNull(maintenanceContracts.startDate),
        isNull(prospects.restrictedAt),
        or(
          isNull(maintenanceContracts.endDate),
          gte(maintenanceContracts.endDate, sql`${now.toISOString().slice(0, 10)}::date`),
        ),
      ),
    )
    .limit(1000);
  let created = 0;
  for (const { contract } of candidates) {
    try {
      const adjustments = await db
        .select()
        .from(contractAdjustments)
        .where(
          and(
            eq(contractAdjustments.workspaceId, contract.workspaceId),
            eq(contractAdjustments.contractId, contract.id),
          ),
        );
      if (pending(adjustments)) continue;
      const dueOn = nextCycle(contract, adjustments);
      if (!dueOn) continue;
      const settings = await loadWorkspaceSettings(db, contract.workspaceId);
      const today = localDateString(now, settings.notifications.timezone);
      const taskDue = addDays(dueOn, -settings.billing.indexNoticeDays);
      const remindFrom = addDays(taskDue, -14);
      if (today < remindFrom) continue;
      // Once per cycle: a task of this cycle is due on or after the day it was created.
      const [existing] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, contract.workspaceId),
            eq(tasks.contractId, contract.id),
            gte(tasks.dueDate, remindFrom),
          ),
        );
      if (existing) continue;
      const owner = await workspaceOwner(db, contract.workspaceId);
      if (!owner) continue;
      await withTenant(db, { userId: owner, workspaceId: contract.workspaceId }, (tx) =>
        tx.insert(tasks).values({
          workspaceId: contract.workspaceId,
          prospectId: contract.prospectId,
          contractId: contract.id,
          title: `Wertsicherung prüfen: ${contract.title}`,
          note: `Den zuletzt veröffentlichten VPI-Wert bei Statistik Austria nachsehen und am Vertrag eintragen. Die Anpassung gilt frühestens ab ${dueOn.split("-").reverse().join(".")}. Die Aufgabe erledigt sich mit der Eintragung.`,
          dueDate: taskDue < today ? today : taskDue,
          reminder: "at_due",
        }),
      );
      created++;
    } catch (error) {
      console.error("index reminder failed", contract.id, error);
    }
  }
  return { created };
}

/**
 * The announcement did not reach the customer (bounce or complaint, from the
 * delivery webhook on the system connection): a change that no invoice has
 * applied yet is withdrawn, so the higher price never applies unannounced.
 */
export async function withdrawUndelivered(
  tx: Transaction | Database,
  workspaceId: string,
  contractId: string,
  sentAt: Date,
): Promise<boolean> {
  const withdrawn = await tx
    .update(contractAdjustments)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(contractAdjustments.workspaceId, workspaceId),
        eq(contractAdjustments.contractId, contractId),
        eq(contractAdjustments.status, "announced"),
        lte(contractAdjustments.announcedAt, sentAt),
      ),
    )
    .returning({ id: contractAdjustments.id });
  return withdrawn.length > 0;
}
