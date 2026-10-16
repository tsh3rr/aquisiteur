import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { HostTarget } from "@/domain/hostname";
import { validateSlug, type SlugProblem } from "@/domain/slug";
import { workspaceSettingsSchema } from "@/domain/workspace-settings";
import type { Role } from "@/domain/authz";
import type { Database, Transaction } from "@/db";
import { DEFAULT_RULES } from "@/domain/notifications";
import {
  auditLog,
  domains,
  memberships,
  notificationRules,
  workspaceSettings,
  workspaces,
} from "@/db/schema";

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  role: Role;
  onboardingCompletedAt: Date | null;
}

export type CreateWorkspaceResult =
  | { ok: true; workspace: { id: string; slug: string } }
  | { ok: false; error: SlugProblem | "slug_taken" };

/**
 * Creates a workspace with its creator as owner. This is one of the few
 * operations that runs on the system connection: before it, the user is a
 * member of nothing, so no tenant context exists yet.
 */
export async function createWorkspace(
  db: Database,
  input: { userId: string; name: string; slug: string },
): Promise<CreateWorkspaceResult> {
  const problem = validateSlug(input.slug);
  if (problem) return { ok: false, error: problem };

  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: input.name, slug: input.slug })
      .onConflictDoNothing({ target: workspaces.slug })
      .returning({ id: workspaces.id, slug: workspaces.slug });
    if (!workspace) return { ok: false as const, error: "slug_taken" as const };

    await tx
      .insert(memberships)
      .values({ workspaceId: workspace.id, userId: input.userId, role: "owner" });
    await tx.insert(workspaceSettings).values({ workspaceId: workspace.id });
    await tx
      .insert(notificationRules)
      .values(DEFAULT_RULES.map((rule) => ({ ...rule, workspaceId: workspace.id })));
    await tx.insert(auditLog).values({
      workspaceId: workspace.id,
      actorUserId: input.userId,
      action: "workspace.created",
      targetType: "workspace",
      targetId: workspace.id,
    });
    return { ok: true as const, workspace };
  });
}

/** Workspaces the (authenticated) user belongs to, oldest first. */
export async function listWorkspacesForUser(
  db: Database,
  userId: string,
): Promise<WorkspaceSummary[]> {
  return db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: memberships.role,
      onboardingCompletedAt: workspaces.onboardingCompletedAt,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
}

/** Public routing: which workspace serves this host? Only active custom domains count. */
export async function resolveWorkspaceByHost(
  db: Database,
  target: HostTarget,
): Promise<{ id: string; slug: string; name: string } | null> {
  const columns = { id: workspaces.id, slug: workspaces.slug, name: workspaces.name };
  if (target.kind === "platform-subdomain") {
    const [row] = await db
      .select(columns)
      .from(workspaces)
      .where(and(eq(workspaces.slug, target.slug), isNotNull(workspaces.onboardingCompletedAt)))
      .limit(1);
    return row ?? null;
  }
  if (target.kind === "custom-domain") {
    const [row] = await db
      .select(columns)
      .from(domains)
      .innerJoin(workspaces, eq(workspaces.id, domains.workspaceId))
      .where(and(eq(domains.hostname, target.hostname), eq(domains.status, "active")))
      .limit(1);
    return row ?? null;
  }
  return null;
}

/** Settings of one workspace by id (system connection; callers scope by host). */
export async function loadWorkspaceSettings(db: Database | Transaction, workspaceId: string) {
  const [row] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return workspaceSettingsSchema.parse(row ?? {});
}
