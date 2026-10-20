import "server-only";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import type { Database, Transaction } from "@/db";
import {
  memberships,
  notificationRules,
  notifications,
  pushSubscriptions,
  users,
} from "@/db/schema";
import {
  DEBOUNCE_MS,
  deliveryFor,
  repushOnUpdate,
  type NotificationChannel,
  type NotificationRule,
  type NotificationTrigger,
} from "@/domain/notifications";
import { getInfra } from "@/infra";
import { notificationEmail } from "@/server/emails/notification";
import { publish, workspaceTopic } from "@/server/realtime";
import { loadWorkspaceSettings } from "@/server/workspaces";

export interface NotifyInput {
  workspaceId: string;
  trigger: Exclude<NotificationTrigger, "daily_digest">;
  prospectId: string | null;
  /** Same key within the debounce window → one notification, updated. */
  groupKey: string;
  title: string;
  body: string;
  /** Cockpit path, normally the prospect's timeline. */
  url: string;
  /** score_threshold: which rule threshold was passed. */
  threshold?: number;
  /** Push button, e.g. „Antworten“ → the chat. */
  action?: { title: string; url: string };
}

export interface Pending {
  id: string;
  workspaceId: string;
  channels: NotificationChannel[];
  action?: NotifyInput["action"];
  /** Grouped into an earlier notification; the push replaces it on the device. */
  update: boolean;
}

/** Enabled rules for a trigger (and threshold), oldest first. */
async function rulesFor(
  db: Database | Transaction,
  workspaceId: string,
  trigger: NotificationTrigger,
  threshold?: number,
): Promise<NotificationRule[]> {
  const rows = await db
    .select()
    .from(notificationRules)
    .where(
      and(
        eq(notificationRules.workspaceId, workspaceId),
        eq(notificationRules.trigger, trigger),
        eq(notificationRules.enabled, true),
        threshold === undefined ? undefined : eq(notificationRules.threshold, threshold),
      ),
    )
    .orderBy(notificationRules.createdAt);
  return rows;
}

/** Thresholds of the enabled score rules. */
export async function scoreThresholds(db: Database | Transaction, workspaceId: string) {
  const rules = await rulesFor(db, workspaceId, "score_threshold");
  return [...new Set(rules.map((rule) => rule.threshold).filter((t): t is number => t !== null))];
}

/**
 * Records a notification when a rule asks for it (§7.7) and says what to
 * deliver. Updates within the debounce window join the existing row.
 */
export async function notify(
  db: Database | Transaction,
  input: NotifyInput,
  now = new Date(),
): Promise<Pending | null> {
  const rules = await rulesFor(db, input.workspaceId, input.trigger, input.threshold);
  if (rules.length === 0) return null;
  const { notifications: settings } = await loadWorkspaceSettings(db, input.workspaceId);
  const deliveries = rules.map((rule) => deliveryFor(rule, now, settings.timezone));
  const channels = [...new Set(deliveries.flatMap((delivery) => delivery.channels))];
  const suppressed = channels.length === 0 ? (deliveries[0]?.suppressed ?? null) : null;

  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, input.workspaceId),
        eq(notifications.groupKey, input.groupKey),
        gt(notifications.updatedAt, new Date(now.getTime() - DEBOUNCE_MS)),
      ),
    )
    .orderBy(desc(notifications.updatedAt))
    .limit(1);

  if (existing) {
    await db
      .update(notifications)
      .set({
        title: input.title,
        body: input.body,
        count: sql`${notifications.count} + 1`,
        readAt: null,
        updatedAt: now,
      })
      .where(
        and(eq(notifications.workspaceId, input.workspaceId), eq(notifications.id, existing.id)),
      );
    const repush = repushOnUpdate(input.trigger) ? channels.filter((c) => c === "push") : [];
    return {
      id: existing.id,
      workspaceId: input.workspaceId,
      channels: repush,
      action: input.action,
      update: true,
    };
  }

  const [row] = await db
    .insert(notifications)
    .values({
      workspaceId: input.workspaceId,
      ruleId: rules[0]!.id,
      prospectId: input.prospectId,
      trigger: input.trigger,
      groupKey: input.groupKey,
      title: input.title,
      body: input.body,
      url: input.url,
      channels,
      suppressed,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: notifications.id });
  await publish([workspaceTopic(input.workspaceId)], "notification.created", {
    id: row!.id,
    title: input.title,
    url: input.url,
  });
  return {
    id: row!.id,
    workspaceId: input.workspaceId,
    channels,
    action: input.action,
    update: false,
  };
}

/** Sends push and e-mail for a recorded notification. Failures are logged, never thrown. */
export async function dispatch(db: Database | Transaction, pending: Pending): Promise<void> {
  if (pending.channels.length === 0) return;
  const [row] = await db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.workspaceId, pending.workspaceId), eq(notifications.id, pending.id)),
    );
  if (!row) return;
  const appUrl = serverEnv().APP_URL.replace(/\/$/, "");
  const { push, email } = getInfra();

  if (pending.channels.includes("push")) {
    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.workspaceId, pending.workspaceId));
    let delivered = false;
    for (const subscription of subscriptions) {
      try {
        const result = await push.send(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          {
            title: row.title,
            body: row.count > 1 ? `${row.body} (${row.count}×)` : row.body,
            url: row.url,
            tag: row.id,
            renotify: pending.update,
            ...(pending.action ? { actions: [{ action: "open", ...pending.action }] } : {}),
          },
        );
        if (result.gone) {
          await db
            .delete(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.workspaceId, pending.workspaceId),
                eq(pushSubscriptions.id, subscription.id),
              ),
            );
        } else {
          delivered = true;
          await db
            .update(pushSubscriptions)
            .set({ lastSuccessAt: new Date() })
            .where(
              and(
                eq(pushSubscriptions.workspaceId, pending.workspaceId),
                eq(pushSubscriptions.id, subscription.id),
              ),
            );
        }
      } catch (error) {
        console.error("push failed", error);
      }
    }
    if (delivered) {
      await db
        .update(notifications)
        .set({ pushedAt: new Date() })
        .where(
          and(eq(notifications.workspaceId, pending.workspaceId), eq(notifications.id, row.id)),
        );
    }
  }

  if (pending.channels.includes("email") && !pending.update) {
    const recipients = await db
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, pending.workspaceId));
    const message = notificationEmail({
      title: row.title,
      body: row.body,
      url: `${appUrl}${row.url}`,
    });
    let sent = false;
    for (const recipient of recipients) {
      try {
        await email.send({ to: recipient.email, ...message });
        sent = true;
      } catch (error) {
        console.error("notification mail failed", error);
      }
    }
    if (sent) {
      await db
        .update(notifications)
        .set({ emailedAt: new Date() })
        .where(
          and(eq(notifications.workspaceId, pending.workspaceId), eq(notifications.id, row.id)),
        );
    }
  }
}

export async function notifyAndDispatch(db: Database, input: NotifyInput, now = new Date()) {
  const pending = await notify(db, input, now);
  if (pending) await dispatch(db, pending);
  return pending;
}
