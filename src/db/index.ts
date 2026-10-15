import { cache } from "react";
import { getInfra } from "@/infra";
import { createDatabase, type Database } from "./client";

export { withTenant, type Database, type TenantContext, type Transaction } from "./client";

let pooled: Database | undefined;

const perRequest = cache((): Database => {
  // On Workers, I/O objects must not outlive the request; Hyperdrive makes
  // a fresh client cheap.
  return createDatabase(getInfra().database.connectionString(), { max: 5 }).db;
});

/** System connection (owner rights). Use withTenant() for workspace data. */
export function getDb(): Database {
  const { database } = getInfra();
  if (database.perRequestClient) return perRequest();
  pooled ??= createDatabase(database.connectionString(), { max: 10 }).db;
  return pooled;
}
