import "server-only";
import { and, asc, eq, getTableColumns, getTableName, inArray, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Transaction } from "@/db";
import * as schema from "@/db/schema";
import { replayFolder } from "@/domain/tracking/replay";

/**
 * Data subject access and portability (§9 „Export pro Prospect“, §9a „pro
 * Workspace“). Everything runs as tenant, so RLS limits it to the caller's
 * workspace on top of the explicit filters. Files in storage (images,
 * recordings) are listed by key, not embedded.
 */

/** Columns never exported: credentials, even hashed or encrypted. */
const SECRET_COLUMNS = new Set(["tokenHash", "secretCiphertext"]);

/** Every table that holds workspace data, in a readable order. */
export const WORKSPACE_TABLES: PgTable[] = [
  schema.workspaceSettings,
  schema.domains,
  schema.integrations,
  schema.apiTokens,
  schema.memberships,
  schema.campaigns,
  schema.prospects,
  schema.contacts,
  schema.exposes,
  schema.exposeVersions,
  schema.assets,
  schema.touchpoints,
  schema.letters,
  schema.visits,
  schema.events,
  schema.consents,
  schema.sessionReplays,
  schema.chatThreads,
  schema.chatMessages,
  schema.chatDrafts,
  schema.callbackRequests,
  schema.tasks,
  schema.projects,
  schema.catalogItems,
  schema.offers,
  schema.offerVersions,
  schema.invoices,
  schema.invoicePayments,
  schema.invoiceReminders,
  schema.invoiceShares,
  schema.outboundEmails,
  schema.maintenanceContracts,
  schema.numberSeries,
  schema.intentScores,
  schema.notificationRules,
  schema.notifications,
  schema.pushSubscriptions,
  schema.savedViews,
  schema.memberPresence,
  schema.usageEvents,
  schema.auditLog,
];

type Row = Record<string, unknown>;

function columnsOf(table: PgTable) {
  return getTableColumns(table) as Record<string, PgColumn>;
}

function clean(table: PgTable, rows: Row[]): Row[] {
  const secret = Object.keys(columnsOf(table)).filter((name) => SECRET_COLUMNS.has(name));
  if (secret.length === 0) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const name of secret) delete copy[name];
    return copy;
  });
}

async function select(tx: Transaction, table: PgTable, where: SQL | undefined): Promise<Row[]> {
  const columns = columnsOf(table);
  const order = columns.id ?? columns.createdAt ?? Object.values(columns)[0]!;
  const rows = (await tx.select().from(table).where(where).orderBy(asc(order))) as Row[];
  return clean(table, rows);
}

export interface ProspectExport {
  format: "aquisiteur.prospect-export";
  version: 1;
  exportedAt: string;
  prospectId: string;
  tables: Record<string, Row[]>;
  files: string[];
}

/** One prospect with everything that refers to it (Art. 15 and 20 DSGVO). */
export async function exportProspect(
  tx: Transaction,
  workspaceId: string,
  prospectId: string,
): Promise<ProspectExport | null> {
  const [prospect] = await select(
    tx,
    schema.prospects,
    and(eq(schema.prospects.workspaceId, workspaceId), eq(schema.prospects.id, prospectId)),
  );
  if (!prospect) return null;
  const tables: Record<string, Row[]> = { prospects: [prospect] };
  for (const table of WORKSPACE_TABLES) {
    const columns = columnsOf(table);
    if (!columns.prospectId || !columns.workspaceId) continue;
    tables[getTableName(table)] = await select(
      tx,
      table,
      and(eq(columns.workspaceId, workspaceId), eq(columns.prospectId, prospectId)),
    );
  }
  const ids = (name: string) => (tables[name] ?? []).map((row) => row.id as string);
  const byParent = async (table: PgTable, column: PgColumn, parentIds: string[]) =>
    parentIds.length === 0
      ? []
      : select(
          tx,
          table,
          and(eq(columnsOf(table).workspaceId!, workspaceId), inArray(column, parentIds)),
        );
  tables.events = await byParent(schema.events, schema.events.visitId, ids("visits"));
  tables.chat_messages = await byParent(
    schema.chatMessages,
    schema.chatMessages.threadId,
    ids("chat_threads"),
  );
  tables.expose_versions = await byParent(
    schema.exposeVersions,
    schema.exposeVersions.exposeId,
    ids("exposes"),
  );
  tables.offer_versions = await byParent(
    schema.offerVersions,
    schema.offerVersions.offerId,
    ids("offers"),
  );
  tables.invoice_payments = await byParent(
    schema.invoicePayments,
    schema.invoicePayments.invoiceId,
    ids("invoices"),
  );
  tables.invoice_shares = await byParent(
    schema.invoiceShares,
    schema.invoiceShares.invoiceId,
    ids("invoices"),
  );
  tables.audit_log = await byParent(schema.auditLog, schema.auditLog.targetId, [
    prospectId,
    ...ids("offers"),
    ...ids("invoices"),
  ]);
  const files = (tables.session_replays ?? []).map((row) =>
    replayFolder(workspaceId, row.id as string),
  );
  return {
    format: "aquisiteur.prospect-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    prospectId,
    tables,
    files,
  };
}

/**
 * The whole workspace as JSON, streamed table by table so a large export
 * does not have to fit in memory at once (§9a „Datenexport pro Workspace“).
 */
export function exportWorkspaceStream(
  run: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>,
  workspaceId: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const PAGE = 1000;
  return new ReadableStream({
    async start(controller) {
      try {
        const write = (text: string) => controller.enqueue(encoder.encode(text));
        const head = await run(async (tx) => {
          const [workspace] = await tx
            .select()
            .from(schema.workspaces)
            .where(eq(schema.workspaces.id, workspaceId));
          return workspace;
        });
        write(
          `{"format":"aquisiteur.workspace-export","version":1,"exportedAt":${JSON.stringify(
            new Date().toISOString(),
          )},"workspace":${JSON.stringify(head ?? null)},"tables":{`,
        );
        let firstTable = true;
        for (const table of WORKSPACE_TABLES) {
          const columns = columnsOf(table);
          const order = columns.id ?? columns.createdAt ?? Object.values(columns)[0]!;
          write(`${firstTable ? "" : ","}${JSON.stringify(getTableName(table))}:[`);
          firstTable = false;
          let first = true;
          for (let offset = 0; ; offset += PAGE) {
            const rows = await run(
              async (tx) =>
                (await tx
                  .select()
                  .from(table)
                  .where(eq(columns.workspaceId!, workspaceId))
                  .orderBy(asc(order))
                  .limit(PAGE)
                  .offset(offset)) as Row[],
            );
            for (const row of clean(table, rows)) {
              write(`${first ? "" : ","}${JSON.stringify(row)}`);
              first = false;
            }
            if (rows.length < PAGE) break;
          }
          write("]");
        }
        write("}}");
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
