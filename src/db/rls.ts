import { sql, type SQL } from "drizzle-orm";
import { type AnyPgColumn, pgPolicy, pgRole } from "drizzle-orm/pg-core";

/**
 * The role every tenant-scoped query runs as (SET LOCAL ROLE inside
 * withTenant). It is created by migration 0000, hence `.existing()`.
 * The login role used by the app keeps owner rights for auth and system work.
 */
export const appRole = pgRole("aquisiteur_app").existing();

/**
 * Standard policy for workspace-scoped tables: the row must belong to the
 * workspace selected for this transaction AND the current user must be a
 * member of it. Membership is checked by app.is_member(), a SECURITY DEFINER
 * function, so the policy never recurses into memberships' own policy.
 */
export function workspaceIsolation(workspaceId: AnyPgColumn): ReturnType<typeof pgPolicy> {
  const predicate: SQL = sql`${workspaceId} = app.current_workspace_id() and app.is_member(${workspaceId})`;
  return pgPolicy("workspace_isolation", {
    as: "permissive",
    for: "all",
    to: appRole,
    using: predicate,
    withCheck: predicate,
  });
}
