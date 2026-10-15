import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb, withTenant, type Transaction } from "@/db";
import type { Actor } from "@/domain/authz";
import { getAuth } from "./auth";
import { listWorkspacesForUser, type WorkspaceSummary } from "./workspaces";

export const ACTIVE_WORKSPACE_COOKIE = "aq_ws";

export const getSession = cache(async () => {
  return getAuth().api.getSession({ headers: await headers() });
});

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

/** The user's workspaces plus the one selected via cookie (or the first). */
export const getWorkspaceContext = cache(async () => {
  const user = await requireUser();
  const workspaces = await listWorkspacesForUser(getDb(), user.id);
  const selectedId = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const active = workspaces.find((w) => w.id === selectedId) ?? workspaces[0] ?? null;
  return { user, workspaces, active };
});

export interface CockpitContext {
  user: Awaited<ReturnType<typeof requireUser>>;
  workspace: WorkspaceSummary;
  actor: Actor;
  /** Runs `fn` as the RLS-restricted tenant role for this user and workspace. */
  tenant: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
}

/** Guard for cockpit pages: signed in, member of a workspace, onboarding done. */
export const requireCockpit = cache(async (): Promise<CockpitContext> => {
  const { user, active } = await getWorkspaceContext();
  if (!active || !active.onboardingCompletedAt) redirect("/onboarding");
  return {
    user,
    workspace: active,
    actor: { userId: user.id, role: active.role, workspaceId: active.id },
    tenant: (fn) => withTenant(getDb(), { userId: user.id, workspaceId: active.id }, fn),
  };
});
