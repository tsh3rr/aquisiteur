import "server-only";
import { and, eq } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import type { Transaction } from "@/db";
import { domains } from "@/db/schema";

/**
 * Origin under which a workspace's public pages are reachable: its first
 * active custom domain, else <slug>.<PLATFORM_DOMAIN>. Scheme and port follow
 * APP_URL, so local development yields http://<slug>.localhost:3000.
 */
export async function workspacePublicOrigin(
  tx: Transaction,
  workspace: { id: string; slug: string },
): Promise<string> {
  const env = serverEnv();
  const app = new URL(env.APP_URL);
  const [custom] = await tx
    .select({ hostname: domains.hostname })
    .from(domains)
    .where(and(eq(domains.workspaceId, workspace.id), eq(domains.status, "active")))
    .limit(1);
  const host = custom?.hostname ?? `${workspace.slug}.${env.PLATFORM_DOMAIN}`;
  return `${app.protocol}//${host}${custom || !app.port ? "" : `:${app.port}`}`;
}

export function exposePath(slug: string): `/x/${string}` {
  return `/x/${slug}`;
}
