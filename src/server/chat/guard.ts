import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { serverEnv } from "@/config/env";
import type { Database, Transaction } from "@/db";
import { exposes, prospects } from "@/db/schema";
import {
  POW_MAX,
  POW_TTL_SECONDS,
  powChallengeId,
  powParts,
  powSolves,
  type PowChallenge,
} from "@/domain/proof-of-work";
import { signToken, verifyToken } from "@/domain/tracking/signed-token";
import { clientIp } from "@/lib/client-ip";
import { hitRateLimit } from "@/server/tracking/rate-limit";
import { clientKey } from "@/server/tracking/short-link-guard";
import { visitForToken } from "@/server/tracking/visits";

/**
 * Bot and abuse protection of the exposé's chat and callback form (§10,
 * ADR-0066), in layers so that none of them has to be perfect:
 *
 * 1. Honeypot field and a proof of work before a thread or callback is
 *    created (domain/proof-of-work), both invisible to people.
 * 2. Rate limits per visit (burst and window), per client network (keyed
 *    hash, never the address), per exposé and per workspace; the last two
 *    hold even when a client rotates addresses.
 * 3. Content rules on the text (domain/chat-guard).
 * 4. The owner can block a prospect's chat and callback form by hand.
 */

function secret() {
  return serverEnv().BETTER_AUTH_SECRET;
}

/** `limit` hits per `seconds`. Exported for the tests. */
export const CHAT_LIMITS = {
  /** One visit: a quick exchange is fine, a flood is not. */
  visitBurst: { limit: 8, seconds: 60 },
  visitWindow: { limit: 30, seconds: 600 },
  /** One client network across all visits and exposés of the workspace. */
  client: { limit: 60, seconds: 600 },
  /** One exposé, however many visits (SECURITY.md M2). */
  expose: { limit: 120, seconds: 3600 },
  /** New conversations on one exposé. */
  exposeThreads: { limit: 10, seconds: 3600 },
  /** Everything the workspace receives; protects the owner's phone from a push flood. */
  workspace: { limit: 600, seconds: 3600 },
  challenge: { limit: 20, seconds: 600 },
} as const;

type Limit = { limit: number; seconds: number };

async function allHit(db: Database, checks: [string, Limit][]): Promise<boolean> {
  const results = await Promise.all(
    checks.map(([key, { limit, seconds }]) => hitRateLimit(db, key, limit, seconds)),
  );
  return results.every(Boolean);
}

export interface MessageLimitInput {
  workspaceId: string;
  visitId: string;
  exposeId: string;
  /** Keyed hash of the client's network (short-link-guard `clientKey`). */
  client: string | null;
  newThread: boolean;
}

/** The client's network for the limits below; null without a known address (all would share one). */
export async function chatClient(headers: Headers): Promise<string | null> {
  return clientIp(headers) ? clientKey(headers, "chat") : null;
}

/** Counts one visitor message on every layer; false when any is exceeded. */
export function hitMessageLimits(db: Database, input: MessageLimitInput): Promise<boolean> {
  const checks: [string, Limit][] = [
    [`chat:burst:${input.visitId}`, CHAT_LIMITS.visitBurst],
    [`chat:msg:${input.visitId}`, CHAT_LIMITS.visitWindow],
    [`chat:x:${input.exposeId}`, CHAT_LIMITS.expose],
    [`chat:ws:${input.workspaceId}`, CHAT_LIMITS.workspace],
  ];
  if (input.client)
    checks.push([`chat:c:${input.workspaceId}:${input.client}`, CHAT_LIMITS.client]);
  if (input.newThread) checks.push([`chat:thread:${input.exposeId}`, CHAT_LIMITS.exposeThreads]);
  return allHit(db, checks);
}

/** Callback requests: per exposé (as before) plus per client network and workspace. */
export function hitCallbackLimits(
  db: Database,
  input: { workspaceId: string; exposeId: string; client: string | null },
): Promise<boolean> {
  const checks: [string, Limit][] = [
    [`callback:${input.exposeId}`, { limit: 10, seconds: 3600 }],
    [`callback:ws:${input.workspaceId}`, { limit: 100, seconds: 3600 }],
  ];
  if (input.client) {
    checks.push([`callback:c:${input.workspaceId}:${input.client}`, { limit: 5, seconds: 3600 }]);
  }
  return allHit(db, checks);
}

/** Whether the owner blocked this prospect's chat and callback form. */
export async function contactBlocked(
  db: Database | Transaction,
  workspaceId: string,
  prospectId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ blockedAt: prospects.chatBlockedAt })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospectId)));
  return Boolean(row?.blockedAt);
}

const subjectOfVisit = (visitId: string) => `v${visitId}`;
const subjectOfExpose = (exposeId: string) => `x${exposeId}`;

export const powSolutionSchema = z.object({
  pow: z.string().min(100).max(300),
  number: z.number().int().min(0).max(POW_MAX),
});

const challengeRequestSchema = z.union([
  z.object({ token: z.string().min(20).max(200) }),
  z.object({ slug: z.string().regex(/^[a-z0-9-]{3,80}$/) }),
]);

async function issue(subject: string): Promise<PowChallenge> {
  return {
    pow: await signToken(secret(), "pow", await powChallengeId(subject), POW_TTL_SECONDS),
    max: POW_MAX,
  };
}

/**
 * A challenge for the chat (bound to the visit) or, without a visit token
 * (tracking blocked), for the callback form (bound to the exposé).
 */
export async function issueChallenge(
  db: Database,
  input: { workspaceId: string; body: unknown },
): Promise<PowChallenge | { error: "invalid" | "limited" | "blocked" }> {
  const parsed = challengeRequestSchema.safeParse(input.body);
  if (!parsed.success) return { error: "invalid" };
  if ("token" in parsed.data) {
    const visit = await visitForToken(db, input.workspaceId, parsed.data.token);
    if (!visit) return { error: "invalid" };
    if (!(await hitRateLimit(db, `pow:${visit.id}`, CHAT_LIMITS.challenge.limit, 600))) {
      return { error: "limited" };
    }
    if (await contactBlocked(db, input.workspaceId, visit.prospectId)) return { error: "blocked" };
    return issue(subjectOfVisit(visit.id));
  }
  const [expose] = await db
    .select({ id: exposes.id, prospectId: exposes.prospectId })
    .from(exposes)
    .where(
      and(
        eq(exposes.workspaceId, input.workspaceId),
        eq(exposes.slug, parsed.data.slug),
        isNull(exposes.unpublishedAt),
      ),
    );
  if (!expose) return { error: "invalid" };
  if (!(await hitRateLimit(db, `pow:x:${expose.id}`, 200, 600))) return { error: "limited" };
  if (await contactBlocked(db, input.workspaceId, expose.prospectId)) return { error: "blocked" };
  return issue(subjectOfExpose(expose.id));
}

/**
 * True when `proof` solves an unexpired challenge issued for this visit or
 * exposé. Stateless: a solution stays valid until its token expires, which
 * is fine because it only ever unlocks the one visit's own thread.
 */
export async function proofValid(
  proof: unknown,
  subject: { visitId?: string | null; exposeId?: string | null },
): Promise<boolean> {
  const parsed = powSolutionSchema.safeParse(proof);
  if (!parsed.success) return false;
  const id = await verifyToken(secret(), "pow", parsed.data.pow);
  const parts = id ? powParts(id) : null;
  if (!id || !parts) return false;
  const allowed = [
    subject.visitId ? subjectOfVisit(subject.visitId) : null,
    subject.exposeId ? subjectOfExpose(subject.exposeId) : null,
  ];
  if (!allowed.includes(parts.subject)) return false;
  return powSolves(id, parsed.data.number);
}
