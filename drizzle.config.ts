import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // Roles are created by the hand-written migration 0000; policies are generated.
  entities: { roles: false },
  strict: true,
  verbose: true,
});
