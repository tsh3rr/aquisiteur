import "server-only";
import { cache } from "react";
import { serverEnv } from "@/config/env";
import { getDb } from "@/db";
import { classifyHost } from "@/domain/hostname";
import { resolveWorkspaceByHost } from "./workspaces";

/** Workspace serving the rewritten /sites/<host>/… request, or null. */
export const workspaceForHostParam = cache(async (hostParam: string) => {
  const env = serverEnv();
  const target = classifyHost(decodeURIComponent(hostParam), {
    appHost: new URL(env.APP_URL).host,
    platformDomain: env.PLATFORM_DOMAIN,
  });
  return resolveWorkspaceByHost(getDb(), target);
});
