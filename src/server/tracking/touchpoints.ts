import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database, Transaction } from "@/db";
import { touchpoints } from "@/db/schema";
import { generateQrToken, generateShortCode } from "@/domain/tracking/short-links";

type Writer = Database | Transaction;

export interface NewTouchpoint {
  workspaceId: string;
  prospectId: string;
  exposeId: string;
  channel: "letter" | "share" | "manual";
  label: string;
  /** Normalised and checked custom code; omitted = random 4-character code, null = none. */
  shortCode?: string | null;
  parentVisitId?: string | null;
  createdByUserId?: string | null;
}

export type CreatedTouchpoint = typeof touchpoints.$inferSelect;

/**
 * Inserts a touchpoint with a fresh QR token and, unless disabled, a short
 * code. Random codes are retried on collision (growing after a few tries);
 * a custom code that is taken returns null so the caller can say so.
 */
export async function createTouchpoint(
  db: Writer,
  input: NewTouchpoint,
): Promise<CreatedTouchpoint | null> {
  const custom = input.shortCode !== undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const shortCode = custom ? input.shortCode! : generateShortCode(attempt < 4 ? 4 : 5);
    const [row] = await db
      .insert(touchpoints)
      .values({
        workspaceId: input.workspaceId,
        prospectId: input.prospectId,
        exposeId: input.exposeId,
        channel: input.channel,
        label: input.label,
        qrToken: generateQrToken(),
        shortCode,
        parentVisitId: input.parentVisitId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    if (custom && shortCode !== null) return null;
  }
  throw new Error("could not allocate touchpoint code");
}

/** The letter touchpoint of an exposé, created on first publish (§6.2). */
export async function ensureLetterTouchpoint(
  tx: Transaction,
  input: { workspaceId: string; prospectId: string; exposeId: string; userId: string | null },
): Promise<CreatedTouchpoint> {
  const [existing] = await tx
    .select()
    .from(touchpoints)
    .where(
      and(
        eq(touchpoints.workspaceId, input.workspaceId),
        eq(touchpoints.exposeId, input.exposeId),
        eq(touchpoints.channel, "letter"),
        isNull(touchpoints.disabledAt),
      ),
    )
    .orderBy(asc(touchpoints.createdAt))
    .limit(1);
  if (existing) return existing;
  const created = await createTouchpoint(tx, {
    workspaceId: input.workspaceId,
    prospectId: input.prospectId,
    exposeId: input.exposeId,
    channel: "letter",
    label: "Brief",
    createdByUserId: input.userId,
  });
  return created!;
}

/** `<origin>/<code>` for a touchpoint: the short code when there is one. */
export function touchpointUrls(
  origin: string,
  touchpoint: { qrToken: string; shortCode: string | null },
) {
  return {
    qrUrl: `${origin}/${touchpoint.qrToken}`,
    shortUrl: touchpoint.shortCode ? `${origin}/${touchpoint.shortCode}` : null,
  };
}
