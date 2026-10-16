"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { apiTokens, auditLog } from "@/db/schema";
import { generateApiToken, hashApiToken } from "@/domain/api-tokens";
import { assertCan } from "@/domain/authz";
import { entitlements } from "@/domain/entitlements";
import { requireCockpit } from "@/server/session";

export interface CreateTokenState {
  token?: string;
  name?: string;
  error?: string;
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Bitte einen Namen angeben.").max(60, "Höchstens 60 Zeichen."),
  expiresInDays: z.enum(["30", "90", "365", "never"]),
});

/** Creates a token and returns it once; only its hash is stored. */
export async function createApiToken(
  _prev: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const { actor, workspace, tenant } = await requireCockpit();
  assertCan(actor, "apiTokens.manage", { workspaceId: workspace.id });
  if (!entitlements({ id: workspace.id }).features.apiTokens) {
    return { error: "API-Tokens sind in Ihrem Tarif nicht enthalten." };
  }
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    expiresInDays: formData.get("expiresInDays"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const { token, prefix } = generateApiToken();
  const days = parsed.data.expiresInDays;
  const expiresAt = days === "never" ? null : new Date(Date.now() + Number(days) * 86_400_000);
  await tenant(async (tx) => {
    const [row] = await tx
      .insert(apiTokens)
      .values({
        workspaceId: workspace.id,
        name: parsed.data.name,
        prefix,
        tokenHash: await hashApiToken(token),
        createdByUserId: actor.userId,
        expiresAt,
      })
      .returning({ id: apiTokens.id });
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: actor.userId,
      action: "api_token.created",
      targetType: "api_token",
      targetId: row?.id,
      meta: { name: parsed.data.name, expiresAt },
    });
  });
  revalidatePath("/settings");
  return { token, name: parsed.data.name };
}

export async function revokeApiToken(formData: FormData): Promise<void> {
  const { actor, workspace, tenant } = await requireCockpit();
  assertCan(actor, "apiTokens.manage", { workspaceId: workspace.id });
  const id = z.uuid().parse(formData.get("id"));
  await tenant(async (tx) => {
    const revoked = await tx
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiTokens.id, id),
          eq(apiTokens.workspaceId, workspace.id),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning({ id: apiTokens.id });
    if (revoked.length > 0) {
      await tx.insert(auditLog).values({
        workspaceId: workspace.id,
        actorUserId: actor.userId,
        action: "api_token.revoked",
        targetType: "api_token",
        targetId: id,
      });
    }
  });
  revalidatePath("/settings");
}
