import { mkdirSync, writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { E2E } from "../../playwright.config";

/** Fresh database and empty mailbox for every E2E run. */
export default async function globalSetup() {
  const client = postgres(E2E.databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(`
      drop schema if exists drizzle cascade;
      drop schema if exists app cascade;
      drop schema if exists public cascade;
      create schema public;
    `);
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }
  mkdirSync("test-results", { recursive: true });
  writeFileSync(E2E.mailLog, "");
}
