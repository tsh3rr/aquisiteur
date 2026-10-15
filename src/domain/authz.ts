/**
 * Central permission check (§9a). Today every workspace has exactly one
 * owner, but all features ask can() so roles can be added without touching
 * call sites.
 */
export type Role = "owner" | "admin" | "member";

export type Action =
  | "workspace.read"
  | "workspace.update"
  | "workspace.delete"
  | "workspace.export"
  | "members.manage"
  | "settings.read"
  | "settings.update"
  | "domains.manage"
  | "integrations.manage"
  | "apiTokens.manage"
  | "auditLog.read"
  | "prospects.read"
  | "prospects.manage"
  | "exposes.read"
  | "exposes.publish"
  | "exposes.manage";

const memberActions: readonly Action[] = [
  "workspace.read",
  "settings.read",
  "prospects.read",
  "exposes.read",
];

const adminActions: readonly Action[] = [
  ...memberActions,
  "workspace.update",
  "members.manage",
  "settings.update",
  "domains.manage",
  "integrations.manage",
  "apiTokens.manage",
  "auditLog.read",
  "prospects.manage",
  "exposes.publish",
  "exposes.manage",
];

const ownerActions: readonly Action[] = [...adminActions, "workspace.delete", "workspace.export"];

const permissions: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(ownerActions),
  admin: new Set(adminActions),
  member: new Set(memberActions),
};

export interface Actor {
  userId: string;
  /** Role in the workspace the resource belongs to; null if not a member. */
  role: Role | null;
  workspaceId: string;
}

export interface Resource {
  workspaceId: string;
}

export function can(actor: Actor, action: Action, resource: Resource): boolean {
  if (actor.role === null) return false;
  if (actor.workspaceId !== resource.workspaceId) return false;
  return permissions[actor.role].has(action);
}

export class ForbiddenError extends Error {
  constructor(action: Action) {
    super(`Forbidden: ${action}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(actor: Actor, action: Action, resource: Resource): void {
  if (!can(actor, action, resource)) throw new ForbiddenError(action);
}
