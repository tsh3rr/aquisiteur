import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, isNotNull } from "drizzle-orm";
import { createDatabase, withTenant } from "../src/db/client";
import {
  events,
  exposes,
  prospects,
  users,
  visits,
  workspaceSettings,
  workspaces,
} from "../src/db/schema";
import { getInfra } from "../src/infra";
import { publishExpose, storeAsset, type PublishContext } from "../src/server/exposes/publish";
import { ensureLetterTouchpoint } from "../src/server/tracking/touchpoints";
import { loadExposeFolder, processImage } from "./lib/expose-folder";

/**
 * Demo data for local development: an owner with a fully set-up workspace
 * and the four example exposés from exposes/, published through the same
 * code path as the CLI. Sign in with a magic link for SEED_OWNER_EMAIL (the
 * link is printed in the dev server log). Idempotent.
 */
const EXAMPLES = ["cafe-mueller", "tischlerei-holzmann", "eisenwerk-athletics", "physio-lindenhof"];

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
        .select({ id: exposes.id, slug: exposes.slug, prospectId: exposes.prospectId })
        .from(exposes)
        .innerJoin(prospects, eq(prospects.id, exposes.prospectId))
        .where(
          and(
            eq(exposes.workspaceId, workspaceId),
            eq(prospects.key, document.prospect.key),
            isNotNull(exposes.currentVersionId),
          ),
        );
      let target: { exposeId: string; prospectId: string };
      if (published) {
        console.info(`Exposé ${name} exists: /x/${published.slug}`);
        target = { exposeId: published.id, prospectId: published.prospectId };
      } else {
        const result = await withTenant(db, { userId: owner.id, workspaceId }, async (tx) => {
          for (const file of files) await storeAsset(tx, storage, context, file);
          return publishExpose(tx, context, {
            document: raw,
            assets: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
          });
        });
        console.info(`Published ${name}: /x/${result.slug} (Ref ${result.refCode})`);
        target = { exposeId: result.exposeId, prospectId: result.prospectId };
      }
      const letter = await withTenant(db, { userId: owner.id, workspaceId }, (tx) =>
        ensureLetterTouchpoint(tx, { workspaceId, ...target, userId: owner.id }),
      );
      console.info(`  Kurzlink /${letter.shortCode}, QR /${letter.qrToken}`);
      if (name === "cafe-mueller") {
        await seedDemoVisits(db, { workspaceId, ...target, touchpointId: letter.id });
      }
    }

    const appUrl = new URL(process.env.APP_URL ?? "http://localhost:3000");
    console.info(
      `Seeded workspace "Pixelwerk Leipzig" for ${email}. Public host: ${appUrl.protocol}//pixelwerk.${process.env.PLATFORM_DOMAIN ?? "localhost"}${appUrl.port ? `:${appUrl.port}` : ""}`,
    );
  } finally {
    await close();
  }
}

/**
 * Two example visits so the customer detail shows a timeline right away:
 * a QR scan read on a phone, and a link preview that is flagged as a bot.
 */
async function seedDemoVisits(
  db: ReturnType<typeof createDatabase>["db"],
  ids: { workspaceId: string; prospectId: string; exposeId: string; touchpointId: string },
) {
  const [existing] = await db
    .select({ id: visits.id })
    .from(visits)
    .where(eq(visits.exposeId, ids.exposeId))
    .limit(1);
  if (existing) return;
  const startedAt = new Date(Date.now() - 26 * 60 * 60 * 1000);
  const at = (seconds: number) => new Date(startedAt.getTime() + seconds * 1000);
  const [scan] = await db
    .insert(visits)
    .values({
      ...ids,
      source: "qr",
      device: "mobile",
      browser: "Safari",
      os: "iOS",
      city: "Leipzig",
      country: "DE",
      confirmedAt: startedAt,
      startedAt,
      lastSeenAt: at(214),
      activeSeconds: 195,
      maxScroll: 75,
      eventCount: 7,
    })
    .returning({ id: visits.id });
  const base = { workspaceId: ids.workspaceId, visitId: scan!.id, exposeId: ids.exposeId };
  await db.insert(events).values([
    { ...base, type: "page_view", occurredAt: at(0) },
    { ...base, type: "section_view", blockId: "vorher-nachher", occurredAt: at(40) },
    {
      ...base,
      type: "section_dwell",
      blockId: "vorher-nachher",
      payload: { seconds: 48 },
      occurredAt: at(88),
    },
    { ...base, type: "section_view", blockId: "preise", occurredAt: at(140) },
    {
      ...base,
      type: "section_dwell",
      blockId: "preise",
      payload: { seconds: 35 },
      occurredAt: at(175),
    },
    { ...base, type: "scroll_depth", payload: { percent: 75 }, occurredAt: at(180) },
    {
      ...base,
      type: "contact_click",
      blockId: "kontakt",
      payload: { channel: "whatsapp" },
      occurredAt: at(210),
    },
  ]);
  await db.insert(visits).values({
    ...ids,
    source: "qr",
    device: "unknown",
    browser: null,
    os: null,
    isBot: true,
    botReason: "Messenger-Vorschau",
    startedAt: at(-120),
    lastSeenAt: at(-120),
  });
  await db
    .update(prospects)
    .set({ status: "opened" })
    .where(and(eq(prospects.id, ids.prospectId), eq(prospects.status, "draft")));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
