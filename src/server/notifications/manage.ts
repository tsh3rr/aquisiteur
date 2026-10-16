import "server-only";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Transaction } from "@/db";
import {
  auditLog,
  notificationRules,
  notifications,
  prospects,
  pushSubscriptions,
} from "@/db/schema";
import type { NotificationRule, RuleInput } from "@/domain/notifications";
import { getInfra } from "@/infra";
import { recomputeIntent } from "@/server/intent/recompute";

/** The owner's side of notifications (§7.7). Always inside withTenant. */

export async function listRules(tx: Transaction, workspaceId: string): Promise<NotificationRule[]> {
  return (
    tx
      .select({
        id: notificationRules.id,
        trigger: notificationRules.trigger,
        threshold: notificationRules.threshold,
        channels: notificationRules.channels,
        enabled: notificationRules.enabled,
        quietFrom: notificationRules.quietFrom,
        quietTo: notificationRules.quietTo,
        weekdaysOnly: notificationRules.weekdaysOnly,
      })
      .from(notificationRules)
      .where(eq(notificationRules.workspaceId, workspaceId))
      // Defaults share one createdAt; the enum order (first visit … digest) breaks the tie.
      .orderBy(asc(notificationRules.createdAt), asc(notificationRules.trigger))
  );
}

export async function saveRule(
  tx: Transaction,
  input: { workspaceId: string; userId: string; id?: string; rule: RuleInput },
): Promise<boolean> {
  if (input.id) {
    const updated = await tx
      .update(notificationRules)
      .set(input.rule)
      .where(
        and(
          eq(notificationRules.workspaceId, input.workspaceId),
          eq(notificationRules.id, input.id),
        ),
      )
      .returning({ id: notificationRules.id });
    if (updated.length === 0) return false;
  } else {
    await tx.insert(notificationRules).values({ ...input.rule, workspaceId: input.workspaceId });
  }
  await tx.insert(auditLog).values({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: input.id ? "notification_rule.updated" : "notification_rule.created",
    targetType: "notification_rule",
    targetId: input.id ?? null,
    meta: { trigger: input.rule.trigger },
  });
  return true;
}

export async function setRuleEnabled(
  tx: Transaction,
  input: { workspaceId: string; userId: string; id: string; enabled: boolean },
) {
  await tx
    .update(notificationRules)
    .set({ enabled: input.enabled })
    .where(
      and(eq(notificationRules.workspaceId, input.workspaceId), eq(notificationRules.id, input.id)),
    );
}

export async function deleteRule(
  tx: Transaction,
  input: { workspaceId: string; userId: string; id: string },
) {
  const deleted = await tx
    .delete(notificationRules)
    .where(
      and(eq(notificationRules.workspaceId, input.workspaceId), eq(notificationRules.id, input.id)),
    )
    .returning({ trigger: notificationRules.trigger });
  if (deleted[0]) {
    await tx.insert(auditLog).values({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "notification_rule.deleted",
      targetType: "notification_rule",
      targetId: input.id,
      meta: { trigger: deleted[0].trigger },
    });
  }
}

export async function savePushSubscription(
  tx: Transaction,
  input: {
    workspaceId: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    label: string | null;
  },
) {
  const { workspaceId, userId, endpoint, p256dh, auth, label } = input;
  await tx
    .insert(pushSubscriptions)
    .values({ workspaceId, userId, endpoint, p256dh, auth, label })
    .onConflictDoUpdate({
      target: [pushSubscriptions.workspaceId, pushSubscriptions.endpoint],
      set: { userId, p256dh, auth, label },
    });
}

/** Removes a device; by endpoint (this browser) or id (the list in the settings). */
export async function removePushSubscription(
  tx: Transaction,
  input: { workspaceId: string; userId: string; endpoint?: string; id?: string },
) {
  if (!input.endpoint && !input.id) return;
  await tx
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.workspaceId, input.workspaceId),
        eq(pushSubscriptions.userId, input.userId),
        input.endpoint
          ? eq(pushSubscriptions.endpoint, input.endpoint)
          : eq(pushSubscriptions.id, input.id!),
      ),
    );
}

export async function listPushDevices(tx: Transaction, workspaceId: string, userId: string) {
  return tx
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      label: pushSubscriptions.label,
      createdAt: pushSubscriptions.createdAt,
      lastSuccessAt: pushSubscriptions.lastSuccessAt,
    })
    .from(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.workspaceId, workspaceId), eq(pushSubscriptions.userId, userId)),
    )
    .orderBy(desc(pushSubscriptions.createdAt));
}

export interface NotificationItem {
  id: string;
  trigger: (typeof notifications.$inferSelect)["trigger"];
  title: string;
  body: string;
  url: string;
  count: number;
  channels: ("push" | "email")[];
  suppressed: string | null;
  pushedAt: Date | null;
  emailedAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listNotifications(
  tx: Transaction,
  workspaceId: string,
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationItem[]> {
  return tx
    .select({
      id: notifications.id,
      trigger: notifications.trigger,
      title: notifications.title,
      body: notifications.body,
      url: notifications.url,
      count: notifications.count,
      channels: notifications.channels,
      suppressed: notifications.suppressed,
      pushedAt: notifications.pushedAt,
      emailedAt: notifications.emailedAt,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      updatedAt: notifications.updatedAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        options.unreadOnly ? isNull(notifications.readAt) : undefined,
      ),
    )
    .orderBy(desc(notifications.updatedAt))
    .limit(options.limit ?? 100);
}

export async function unreadNotificationCount(tx: Transaction, workspaceId: string) {
  const [row] = await tx
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.workspaceId, workspaceId), isNull(notifications.readAt)));
  return row?.value ?? 0;
}

/** Marks some (or, without ids, all) notifications as read. */
export async function markNotificationsRead(tx: Transaction, workspaceId: string, ids?: string[]) {
  await tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined,
      ),
    );
}

/** After the weights change: every prospect's score again, without notifying anyone. */
export async function recomputeAllScores(tx: Transaction, workspaceId: string, now = new Date()) {
  const rows = await tx
    .select({ id: prospects.id })
    .from(prospects)
    .where(eq(prospects.workspaceId, workspaceId));
  for (const row of rows) await recomputeIntent(tx, workspaceId, row.id, now);
  return rows.length;
}

/** „Test senden“: one push to the user's devices in this workspace. */
export async function sendTestPush(tx: Transaction, workspaceId: string, userId: string) {
  const devices = await tx
    .select()
    .from(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.workspaceId, workspaceId), eq(pushSubscriptions.userId, userId)),
    );
  let delivered = 0;
  for (const device of devices) {
    try {
      const result = await getInfra().push.send(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        {
          title: "Aquisiteur: Test",
          body: "So sehen Benachrichtigungen auf diesem Gerät aus.",
          url: "/benachrichtigungen",
          tag: "test",
        },
      );
      if (result.gone) {
        await tx
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.workspaceId, workspaceId),
              eq(pushSubscriptions.id, device.id),
            ),
          );
      } else {
        delivered += 1;
      }
    } catch (error) {
      console.error("test push failed", error);
    }
  }
  return { devices: devices.length, delivered };
}
