import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverEnv } from "@/config/env";
import { getDb } from "@/db";
import { classifyHost } from "@/domain/hostname";
import { resolveWorkspaceByHost } from "@/server/workspaces";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Public pages of a workspace, reached via the proxy's host rewrite.
 * Phase 0 only proves the routing; exposés (phase 1) and short links
 * (phase 2) live under this segment.
 */
export default async function WorkspaceSitePage({
  params,
}: {
  params: Promise<{ host: string; path?: string[] }>;
}) {
  const { host, path } = await params;
  const env = serverEnv();
  const target = classifyHost(decodeURIComponent(host), {
    appHost: new URL(env.APP_URL).host,
    platformDomain: env.PLATFORM_DOMAIN,
  });
  const workspace = await resolveWorkspaceByHost(getDb(), target);
  if (!workspace || (path && path.length > 0)) notFound();

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6">
      <div className="grid max-w-md gap-2 text-center">
        <h1 className="text-2xl font-semibold">{workspace.name}</h1>
        <p className="text-foreground-muted">
          Hier erscheinen persönliche Exposés. Haben Sie einen Brief von uns erhalten? Scannen Sie
          den QR-Code oder tippen Sie den Link aus dem Brief ein.
        </p>
      </div>
    </main>
  );
}
