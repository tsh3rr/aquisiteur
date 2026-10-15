import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDatabase(connectionString: string, options: { max?: number } = {}): {
  db: Database;
  close: () => Promise<void>;
} {
  const client = postgres(connectionString, {
    max: options.max ?? 5,
    // Hyperdrive and most poolers do not support the extra round trip.
    fetch_types: false,
    prepare: false,
    onnotice: () => {},
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export interface TenantContext {
  userId: string;
  workspaceId: string;
}

/**
 * Runs `fn` in a transaction as the RLS-restricted tenant role, scoped to one
 * user and one workspace. All feature code reads and writes workspace data
 * through this; the unscoped system connection is reserved for auth,
 * workspace creation and background jobs.
 */
export async function withTenant<T>(
  db: Database,
  context: TenantContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role aquisiteur_app`);
    await tx.execute(
      sql`select set_config('app.user_id', ${context.userId}, true), set_config('app.workspace_id', ${context.workspaceId}, true)`,
    );
    return fn(tx);
  });
}
