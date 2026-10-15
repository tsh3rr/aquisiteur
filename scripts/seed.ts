import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, isNotNull } from "drizzle-orm";
import { createDatabase, withTenant } from "../src/db/client";
import { exposes, prospects, users, workspaceSettings, workspaces } from "../src/db/schema";
import { getInfra } from "../src/infra";
import { publishExpose, storeAsset, type PublishContext } from "../src/server/exposes/publish";
import { loadExposeFolder, processImage } from "./lib/expose-folder";

/**
 * Demo data for local development: an owner with a fully set-up workspace
 * and the two example exposés from exposes/, published through the same
 * code path as the CLI. Sign in with a magic link for SEED_OWNER_EMAIL (the
 * link is printed in the dev server log). Idempotent.
 */
const EXAMPLES = ["cafe-mueller", "tischlerei-holzmann"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const email = (process.env.SEED_OWNER_EMAIL ?? "owner@example.com").toLowerCase();
  const { db, close } = createDatabase(url, { max: 1 });
  const storage = getInfra().storage;

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
      const { createWorkspace } = await import("../src/server/workspaces");
      const result = await createWorkspace(db, {
        userId: owner.id,
        name: "Pixelwerk Leipzig",
        slug: "pixelwerk",
      });
      if (!result.ok) throw new Error(`seed workspace: ${result.error}`);
      workspaceId = result.workspace.id;
    }
    const context: PublishContext = { workspaceId, userId: owner.id, source: "seed" };

    const photoPath = "scripts/seed-assets/owner.svg";
    const photoBytes = await readFile(photoPath);
    const photo = await processImage(
      "assets/owner.svg",
      createHash("sha256").update(photoBytes).digest("hex"),
      photoBytes,
      true,
    );
    const { assetId: photoAssetId } = await withTenant(
      db,
      { userId: owner.id, workspaceId },
      (tx) => storeAsset(tx, storage, context, photo),
    );

    await db
      .update(workspaceSettings)
      .set({
        profile: { displayName: "Jeremiasz Kapek", role: "Inhaber", photoAssetId },
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
        legal: {
          imprintMarkdown:
            "**Pixelwerk Leipzig**\nJeremiasz Kapek\nKarl-Liebknecht-Straße 12\n04107 Leipzig\n\nE-Mail: hallo@pixelwerk.example\nTelefon: +49 341 1234567",
        },
      })
      .where(eq(workspaceSettings.workspaceId, workspaceId));
    await db
      .update(workspaces)
      .set({ onboardingCompletedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));

    for (const name of EXAMPLES) {
      const loaded = await loadExposeFolder(`exposes/${name}`, { optimize: true });
      if (!loaded.ok) {
        throw new Error(
          `${name}: ${loaded.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`,
        );
      }
      const { document, raw, files } = loaded.expose;
      const [published] = await db
        .select({ slug: exposes.slug })
        .from(exposes)
        .innerJoin(prospects, eq(prospects.id, exposes.prospectId))
        .where(
          and(
            eq(exposes.workspaceId, workspaceId),
            eq(prospects.key, document.prospect.key),
            isNotNull(exposes.currentVersionId),
          ),
        );
      if (published) {
        console.info(`Exposé ${name} exists: /x/${published.slug}`);
        continue;
      }
      const result = await withTenant(db, { userId: owner.id, workspaceId }, async (tx) => {
        for (const file of files) await storeAsset(tx, storage, context, file);
        return publishExpose(tx, context, {
          document: raw,
          assets: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
        });
      });
      console.info(`Published ${name}: /x/${result.slug} (Ref ${result.refCode})`);
    }

    const appUrl = new URL(process.env.APP_URL ?? "http://localhost:3000");
    console.info(
      `Seeded workspace "Pixelwerk Leipzig" for ${email}. Public host: ${appUrl.protocol}//pixelwerk.${process.env.PLATFORM_DOMAIN ?? "localhost"}${appUrl.port ? `:${appUrl.port}` : ""}`,
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
