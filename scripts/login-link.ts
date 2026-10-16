import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { users, verifications, workspaces } from "../src/db/schema";

/**
 * Creates an account (if missing) and prints a one-time sign-in link, without
 * sending any mail. For the first login on a fresh deployment before e-mail
 * is set up. Optionally creates a ready workspace so the wizard is skipped.
 *
 *   DATABASE_URL=… APP_URL=https://app.example.de pnpm user:login you@example.de \
 *     [--name "Vor Nachname"] [--workspace "Agentur" --slug agentur]
 *
 * The token is stored exactly like Better Auth's magic-link plugin does with
 * `storeToken: "hashed"` (src/server/auth.ts): identifier
 * `magic-link:<base64url(sha256(token))>`, verified by /api/auth/magic-link/verify.
 */
const VALID_MINUTES = 30;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: "string" },
      workspace: { type: "string" },
      slug: { type: "string" },
    },
  });
  const email = positionals[0]?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error(
      'Usage: pnpm user:login <email> [--name "Name"] [--workspace "Name" --slug slug]',
    );
  }
  if (values.workspace && !values.slug) throw new Error("--workspace needs --slug");
  const url = process.env.DATABASE_URL;
  const appUrl = process.env.APP_URL;
  if (!url || !appUrl) throw new Error("DATABASE_URL and APP_URL must be set");

  const { db, close } = createDatabase(url, { max: 1 });
  try {
    let [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
      [user] = await db
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          email,
          name: values.name ?? "",
          emailVerified: true,
        })
        .returning();
      console.info(`Created account ${email}.`);
    }
    if (!user) throw new Error("could not create the account");

    if (values.workspace && values.slug) {
      const [taken] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, values.slug));
      if (taken) {
        console.info(`Workspace "${values.slug}" exists already; left unchanged.`);
      } else {
        const { createWorkspace } = await import("../src/server/workspaces");
        const result = await createWorkspace(db, {
          userId: user.id,
          name: values.workspace,
          slug: values.slug,
        });
        if (!result.ok) throw new Error(`workspace: ${result.error}`);
        await db
          .update(workspaces)
          .set({ onboardingCompletedAt: new Date() })
          .where(eq(workspaces.id, result.workspace.id));
        console.info(`Created workspace "${values.workspace}" (${values.slug}).`);
      }
    }

    const token = randomBytes(24).toString("base64url");
    const hashed = createHash("sha256").update(token).digest("base64url");
    await db.insert(verifications).values({
      id: crypto.randomUUID(),
      identifier: `magic-link:${hashed}`,
      value: JSON.stringify({ type: "magic-link", email }),
      expiresAt: new Date(Date.now() + VALID_MINUTES * 60_000),
    });
    const link = new URL("/api/auth/magic-link/verify", appUrl);
    link.searchParams.set("token", token);
    link.searchParams.set("callbackURL", "/");
    console.info(`\nSign-in link (valid ${VALID_MINUTES} minutes, works once):\n${link}\n`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
