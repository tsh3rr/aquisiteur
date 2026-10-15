import "dotenv/config";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { users, workspaceSettings, workspaces } from "../src/db/schema";
import { createWorkspace } from "../src/server/workspaces";

/**
 * Demo data for local development: an owner with a fully set-up workspace,
 * so the cockpit is visible right after `pnpm db:seed`. Sign in with a magic
 * link for SEED_OWNER_EMAIL (the link is printed in the dev server log).
 * Idempotent. Example prospects and exposés arrive with phase 1.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const email = (process.env.SEED_OWNER_EMAIL ?? "owner@example.com").toLowerCase();
  const { db, close } = createDatabase(url, { max: 1 });

  try {
    let [owner] = await db.select().from(users).where(eq(users.email, email));
    if (!owner) {
      [owner] = await db
        .insert(users)
        .values({ id: crypto.randomUUID(), email, name: "Jeremiasz Kapek", emailVerified: true })
        .returning();
    }
    if (!owner) throw new Error("could not create owner");

    const [existing] = await db.select().from(workspaces).where(eq(workspaces.slug, "pixelwerk"));
    let workspaceId = existing?.id;
    if (!workspaceId) {
      const result = await createWorkspace(db, {
        userId: owner.id,
        name: "Pixelwerk Leipzig",
        slug: "pixelwerk",
      });
      if (!result.ok) throw new Error(`seed workspace: ${result.error}`);
      workspaceId = result.workspace.id;
    }

    await db
      .update(workspaceSettings)
      .set({
        profile: { displayName: "Jeremiasz Kapek", role: "Inhaber" },
        channels: {
          email: "hallo@pixelwerk.example",
          phone: "+49 341 1234567",
          mobile: "+49 170 1234567",
          whatsapp: "+49 170 1234567",
        },
        senderAddress: {
          company: "Pixelwerk Leipzig",
          street: "Karl-Liebknecht-Straße 12",
          postalCode: "04107",
          city: "Leipzig",
          country: "DE",
        },
        branding: { accentColor: "#4f3bd9" },
      })
      .where(eq(workspaceSettings.workspaceId, workspaceId));
    await db
      .update(workspaces)
      .set({ onboardingCompletedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));

    console.info(`Seeded workspace "Pixelwerk Leipzig" for ${email}.`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
