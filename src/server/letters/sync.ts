import "server-only";
import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";

const DAY = 24 * 3600 * 1000;
import type { Database } from "@/db";
import { letters } from "@/db/schema";
import { recordProviderUpdates } from "@/server/letters/manage";
import { letterProvider } from "@/server/letters/providers";

/**
 * Hourly job: asks the print API for letters still on their way (§7.9), as a
 * safety net for webhooks that never arrived or were not set up. Letters
 * submitted within the last hour are left to the webhook. Each check moves
 * the letter to the back of the queue, so letters that never resolve cannot
 * starve the others; after 60 days a letter is no longer asked about.
 */
export async function syncLetterStatuses(db: Database, now = new Date()) {
  const pending = await db
    .select({
      id: letters.id,
      workspaceId: letters.workspaceId,
      provider: letters.provider,
      providerRef: letters.providerRef,
    })
    .from(letters)
    .where(
      and(
        ne(letters.provider, "manual"),
        inArray(letters.status, ["queued", "submitted", "printed"]),
        lte(letters.submittedAt, new Date(now.getTime() - 3600 * 1000)),
        gte(letters.submittedAt, new Date(now.getTime() - 60 * DAY)),
      ),
    )
    .orderBy(asc(letters.updatedAt))
    .limit(100);

  let changed = 0;
  for (const letter of pending) {
    if (!letter.providerRef) continue;
    await db
      .update(letters)
      .set({ updatedAt: now })
      .where(and(eq(letters.workspaceId, letter.workspaceId), eq(letters.id, letter.id)));
    try {
      const provider = await letterProvider(db, letter.workspaceId, letter.provider);
      const status = provider ? await provider.getStatus(letter.providerRef) : null;
      if (!status) continue;
      changed += await recordProviderUpdates(
        db,
        letter.workspaceId,
        [letter.provider],
        [{ providerRef: letter.providerRef, at: now, reason: null, ...status }],
      );
    } catch (error) {
      console.error("letter status sync failed", letter.id, error);
    }
  }
  return { checked: pending.length, changed };
}
