import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import { invoicePayments, invoiceReminders, invoices } from "@/db/schema";

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
 * Drafts that lost their reason: the invoice is paid in full or cancelled.
 * Called after a payment or a cancellation; the approval tasks go with them.
 */
export async function dropSettledReminders(
  tx: Transaction,
  workspaceId: string,
  invoiceId: string,
): Promise<void> {
  const [invoice] = await tx
    .select({ status: invoices.status, totals: invoices.totals })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)));
  if (!invoice) return;
  const settled =
    invoice.status !== "issued" ||
    (await paidCents(tx, workspaceId, invoiceId)) >= (invoice.totals?.dueCents ?? 0);
  if (!settled) return;
  await tx
    .delete(invoiceReminders)
    .where(
      and(
        eq(invoiceReminders.workspaceId, workspaceId),
        eq(invoiceReminders.invoiceId, invoiceId),
        eq(invoiceReminders.status, "draft"),
      ),
    );
}
