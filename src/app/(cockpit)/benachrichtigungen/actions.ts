"use server";

import { assertCan } from "@/domain/authz";
import { unreadNotificationCount } from "@/server/notifications/manage";
import { requireCockpit } from "@/server/session";

/** The bell's badge, refreshed when a notification arrives live. */
export async function unreadNotifications(): Promise<number> {
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "workspace.read", { workspaceId: workspace.id });
  return tenant((tx) => unreadNotificationCount(tx, workspace.id));
}
