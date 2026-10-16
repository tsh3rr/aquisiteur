import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Resets TEST_DATABASE_URL and applies all migrations, so DB tests always
 * run against exactly what production gets.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must point to a disposable database");
  const client = postgres(url, { max: 1, onnotice: () => {} });
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
}
