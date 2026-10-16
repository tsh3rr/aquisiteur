import "dotenv/config";
import postgres from "postgres";

/** Drops all app schemas in DATABASE_URL. Local development only. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "postgres"].includes(host) && process.env.FORCE_RESET !== "1") {
    throw new Error(
      `Refusing to reset non-local database at ${host} (set FORCE_RESET=1 to override)`,
    );
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(`
      drop schema if exists drizzle cascade;
      drop schema if exists app cascade;
      drop schema if exists public cascade;
      create schema public;
    `);
    console.info("Database reset. Run `pnpm db:migrate` next.");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
