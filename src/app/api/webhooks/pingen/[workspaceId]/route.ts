import { z } from "zod";
import { getDb } from "@/db";
import { recordProviderUpdates } from "@/server/letters/manage";
import { letterProvider } from "@/server/letters/providers";

export const dynamic = "force-dynamic";

/**
 * Status webhooks from Pingen (§7.9), one URL per workspace, as shown under
 * Einstellungen → Briefe → Druckdienst. The body is verified against the
 * workspace's signing key before anything is read from it; delivery is
 * at-least-once, and repeated events change nothing.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const workspaceId = z.uuid().safeParse((await params).workspaceId);
  if (!workspaceId.success) return new Response("Not found", { status: 404 });
  const db = getDb();
  const provider = await letterProvider(db, workspaceId.data, "pingen");
  if (!provider?.handleWebhook) return new Response("Not found", { status: 404 });
  let updates;
  try {
    updates = await provider.handleWebhook(request);
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 400;
    return new Response("Rejected", { status: status >= 400 && status < 500 ? status : 400 });
  }
  await recordProviderUpdates(db, workspaceId.data, provider.id, updates);
  return new Response(null, { status: 204 });
}
