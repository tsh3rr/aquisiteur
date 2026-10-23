import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import { invoicePayments, invoiceReminders, invoices, tasks } from "@/db/schema";

/** Kept apart from dunning.ts so manage.ts can use it without an import cycle. */

export async function paidCents(tx: Transaction, workspaceId: string, invoiceId: string) {
  const [row] = await tx
    .select({ sum: sql<string | null>`sum(${invoicePayments.amountCents})` })
    .from(invoicePayments)
    .where(
      and(eq(invoicePayments.workspaceId, workspaceId), eq(invoicePayments.invoiceId, invoiceId)),
    );
  return Number(row?.sum ?? 0);
}

/**
 * Sets waiting drafts aside instead of deleting them, so a mail already on its
 * way keeps its log and the hourly job does not draft the level again at
 * once; their approval tasks are done. `deadline` starts a pause (discard).
 */
export async function skipReminderDrafts(
  tx: Transaction,
  workspaceId: string,
  where: { invoiceId: string } | { reminderId: string },
  now: Date,
  deadline?: string,
): Promise<{ id: string; invoiceId: string }[]> {
  const skipped = await tx
    .update(invoiceReminders)
    .set({ status: "skipped", ...(deadline ? { deadline } : {}) })
    .where(
      and(
        eq(invoiceReminders.workspaceId, workspaceId),
        "invoiceId" in where
          ? eq(invoiceReminders.invoiceId, where.invoiceId)
          : eq(invoiceReminders.id, where.reminderId),
        eq(invoiceReminders.status, "draft"),
      ),
    )
    .returning({ id: invoiceReminders.id, invoiceId: invoiceReminders.invoiceId });
  if (skipped.length > 0) {
    await tx
      .update(tasks)
      .set({ doneAt: now })
      .where(
        and(
          eq(tasks.workspaceId, workspaceId),
          inArray(
            tasks.reminderId,
            skipped.map((row) => row.id),
          ),
          isNull(tasks.doneAt),
        ),
      );
  }
  return skipped;
}

/**
 * Drafts that lost their reason: the invoice is paid in full or cancelled.
 * Called after a payment or a cancellation.
 */
export async function dropSettledReminders(
  tx: Transaction,
  workspaceId: string,
  invoiceId: string,
  now = new Date(),
): Promise<void> {
  const [invoice] = await tx
    .select({ status: invoices.status, totals: invoices.totals })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)));
  if (!invoice) return;
  const settled =
    invoice.status !== "issued" ||
    (await paidCents(tx, workspaceId, invoiceId)) >= (invoice.totals?.dueCents ?? 0);
  if (settled) await skipReminderDrafts(tx, workspaceId, { invoiceId }, now);
}
