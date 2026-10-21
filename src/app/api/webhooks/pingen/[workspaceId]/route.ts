import { z } from "zod";
import { getDb } from "@/db";
import { readBodyLimited } from "@/lib/body";
import { PINGEN_PROVIDERS, recordProviderUpdates } from "@/server/letters/manage";
import { letterProvider } from "@/server/letters/providers";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * Status webhooks from Pingen (§7.9), one URL per workspace, as shown under
 * Einstellungen → Briefe → Druckdienst. The body is read with a size limit and
 * verified against the workspace's signing key before anything is read from
 * it; delivery is at-least-once, and repeated events change nothing.
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
  const body = await readBodyLimited(request, MAX_WEBHOOK_BYTES);
  if (!body) return new Response("Too large", { status: 413 });
  let updates;
  try {
    updates = await provider.handleWebhook(body, request.headers);
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 400;
    return new Response("Rejected", { status: status >= 400 && status < 500 ? status : 400 });
  }
  // The same URL serves Pingen's test and live environment.
  await recordProviderUpdates(db, workspaceId.data, PINGEN_PROVIDERS, updates);
  return new Response(null, { status: 204 });
}
