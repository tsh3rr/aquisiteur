import "server-only";
import { and, count, countDistinct, desc, eq, gt, gte, isNotNull, sql } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import type { Database } from "@/db";
import {
  callbackRequests,
  chatMessages,
  chatThreads,
  intentScores,
  memberships,
  notificationRules,
  notifications,
  prospects,
  users,
  visits,
} from "@/db/schema";
import { deliveryFor, localClock, notificationUrl } from "@/domain/notifications";
import { getInfra } from "@/infra";
import { digestEmail, type DigestItem } from "@/server/emails/notification";
import { dispatch } from "@/server/notifications/notify";
import { loadWorkspaceSettings } from "@/server/workspaces";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-10-16" in the workspace's time zone: one digest per local day. */
export function localDate(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(now);
}

function germanDate(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}

export interface DigestContent {
  visits: number;
  prospects: number;
  unreadChats: number;
  openCallbacks: number;
  top: { prospectId: string; company: string; score: number; headline: string; detail: string }[];
}

/** What happened in the last 24 hours (§7.7 „Tageszusammenfassung“). Job code: scoped by hand. */
export async function digestContent(
  db: Database,
  workspaceId: string,
  now: Date,
): Promise<DigestContent> {
  const since = new Date(now.getTime() - DAY_MS);
  const [visitRow, unreadRow, callbackRow, top] = await Promise.all([
    db
      .select({ visits: count(), prospects: countDistinct(visits.prospectId) })
      .from(visits)
      .where(
        and(
          eq(visits.workspaceId, workspaceId),
          gte(visits.startedAt, since),
          isNotNull(visits.confirmedAt),
          eq(visits.isBot, false),
          eq(visits.isInternal, false),
        ),
      ),
    db
      .select({ value: countDistinct(chatThreads.id) })
      .from(chatThreads)
      .innerJoin(
        chatMessages,
        and(
          eq(chatMessages.workspaceId, chatThreads.workspaceId),
          eq(chatMessages.threadId, chatThreads.id),
        ),
      )
      .where(
        and(
          eq(chatThreads.workspaceId, workspaceId),
          eq(chatMessages.author, "visitor"),
          sql`(${chatThreads.ownerReadAt} is null or ${chatMessages.createdAt} > ${chatThreads.ownerReadAt})`,
        ),
      ),
    db
      .select({ value: count() })
      .from(callbackRequests)
      .where(
        and(eq(callbackRequests.workspaceId, workspaceId), eq(callbackRequests.status, "open")),
      ),
    db
      .select({
        prospectId: intentScores.prospectId,
        company: prospects.companyName,
        score: intentScores.score,
        explanation: intentScores.explanation,
      })
      .from(intentScores)
      .innerJoin(
        prospects,
        and(
          eq(prospects.workspaceId, intentScores.workspaceId),
          eq(prospects.id, intentScores.prospectId),
        ),
      )
      .where(
        and(
          eq(intentScores.workspaceId, workspaceId),
          gte(intentScores.lastSignalAt, since),
          gt(intentScores.score, 0),
        ),
      )
      .orderBy(desc(intentScores.score), desc(intentScores.lastSignalAt))
      .limit(5),
  ]);
  return {
    visits: visitRow[0]?.visits ?? 0,
    prospects: visitRow[0]?.prospects ?? 0,
    unreadChats: unreadRow[0]?.value ?? 0,
    openCallbacks: callbackRow[0]?.value ?? 0,
    top: top.map((row) => ({
      prospectId: row.prospectId,
      company: row.company,
      score: row.score,
      headline: row.explanation.headline,
      detail: row.explanation.recommendation,
    })),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function digestSummary(content: DigestContent): string | null {
  const parts: string[] = [];
  if (content.visits > 0) {
    parts.push(
      `${plural(content.visits, "Besuch", "Besuche")} von ${plural(content.prospects, "Kunden", "Kunden")}`,
    );
  }
  if (content.unreadChats > 0) {
    parts.push(plural(content.unreadChats, "ungelesener Chat", "ungelesene Chats"));
  }
  if (content.openCallbacks > 0) {
    parts.push(plural(content.openCallbacks, "offene Rückrufbitte", "offene Rückrufbitten"));
  }
  if (parts.length === 0) return null;
  const last = parts.pop()!;
  return `In den letzten 24 Stunden: ${parts.length > 0 ? `${parts.join(", ")} und ${last}` : last}.`;
}

export type DigestOutcome = "sent" | "recorded" | "nothing" | "not_due" | "done";

/** Sends one workspace's digest when its hour has come and today's is not out yet. */
export async function runDigest(
  db: Database,
  rule: typeof notificationRules.$inferSelect,
  now: Date,
): Promise<DigestOutcome> {
  const { notifications: settings } = await loadWorkspaceSettings(db, rule.workspaceId);
  const { hour } = localClock(now, settings.timezone);
  if (hour < (rule.threshold ?? 8)) return "not_due";
  const date = localDate(now, settings.timezone);
  const groupKey = `digest:${date}`;
  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(eq(notifications.workspaceId, rule.workspaceId), eq(notifications.groupKey, groupKey)),
    );
  if (existing) return "done";

  const content = await digestContent(db, rule.workspaceId, now);
  const summary = digestSummary(content);
  if (!summary) return "nothing";

  const delivery = deliveryFor(rule, now, settings.timezone);
  const appUrl = serverEnv().APP_URL.replace(/\/$/, "");
  const title = `Ihr Überblick für ${germanDate(now, settings.timezone)}`;
  const [row] = await db
    .insert(notifications)
    .values({
      workspaceId: rule.workspaceId,
      ruleId: rule.id,
      trigger: "daily_digest",
      groupKey,
      title,
      body: summary,
      url: notificationUrl({ trigger: "daily_digest" }),
      channels: delivery.channels,
      suppressed: delivery.suppressed,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: notifications.id });
  if (!row) return "done";

  if (delivery.channels.includes("push")) {
    await dispatch(db, {
      id: row.id,
      workspaceId: rule.workspaceId,
      channels: ["push"],
      update: false,
    });
  }
  if (delivery.channels.includes("email")) {
    const items: DigestItem[] = content.top.map((item) => ({
      title: `${item.company}: ${item.headline}`,
      body: item.detail,
      url: `${appUrl}/kunden/${item.prospectId}`,
    }));
    const message = digestEmail({
      date: germanDate(now, settings.timezone),
      summary,
      items,
      url: `${appUrl}${notificationUrl({ trigger: "daily_digest" })}`,
    });
    const recipients = await db
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, rule.workspaceId));
    let sent = false;
    for (const recipient of recipients) {
      try {
        await getInfra().email.send({ to: recipient.email, ...message });
        sent = true;
      } catch (error) {
        console.error("digest mail failed", error);
      }
    }
    if (sent) {
      await db
        .update(notifications)
        .set({ emailedAt: new Date() })
        .where(and(eq(notifications.workspaceId, rule.workspaceId), eq(notifications.id, row.id)));
    }
  }
  return delivery.channels.length > 0 ? "sent" : "recorded";
}

/** The hourly job: every workspace with an enabled digest rule. */
export async function runDigests(db: Database, now = new Date()) {
  const rules = await db
    .select()
    .from(notificationRules)
    .where(and(eq(notificationRules.trigger, "daily_digest"), eq(notificationRules.enabled, true)))
    .orderBy(notificationRules.createdAt);
  const seen = new Set<string>();
  const outcomes: Record<DigestOutcome, number> = {
    sent: 0,
    recorded: 0,
    nothing: 0,
    not_due: 0,
    done: 0,
  };
  for (const rule of rules) {
    // One digest per workspace, even with two digest rules.
    if (seen.has(rule.workspaceId)) continue;
    seen.add(rule.workspaceId);
    try {
      outcomes[await runDigest(db, rule, now)] += 1;
    } catch (error) {
      console.error("digest failed", rule.workspaceId, error);
    }
  }
  return outcomes;
}
