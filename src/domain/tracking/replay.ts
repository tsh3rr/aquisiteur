import { z } from "zod";
import { CONSENT_PURPOSES } from "./consent";

/**
 * Session replay after consent (§6.3, §9 „§ 25 TDDDG“). Nothing is recorded
 * before the visitor allows it in the consent notice (consent.ts), where
 * „Ablehnen“ is just as prominent.
 */

export const REPLAY_LIMITS = {
  /** Raw JSON per upload. */
  chunkBytes: 256 * 1024,
  /** Stored, compressed, per visit. */
  totalBytes: 8 * 1024 * 1024,
  chunks: 400,
  eventsPerChunk: 2000,
  /** The script uploads at least this often while recording. */
  flushMs: 10_000,
} as const;

const token = z.string().min(20).max(200);

export const consentDecisionSchema = z.enum(["given", "denied", "withdrawn"]);
export type ConsentDecision = z.infer<typeof consentDecisionSchema>;

/** One decision for one purpose; without `scope` it is the recording (phase 5 clients). */
export const consentBodySchema = z.object({
  token,
  scope: z.enum(CONSENT_PURPOSES).default("replay"),
  decision: consentDecisionSchema,
  version: z.string().min(1).max(40),
});

/** rrweb events: a numeric type and a timestamp; the rest is opaque. */
const replayEvent = z.looseObject({ type: z.number().int().min(0).max(10), timestamp: z.number() });
export type ReplayEvent = z.infer<typeof replayEvent>;

export const replayChunkSchema = z.object({
  token,
  events: z.array(replayEvent).min(1).max(REPLAY_LIMITS.eventsPerChunk),
});

/** Storage key of chunk `n`; always below the workspace's prefix. */
export function replayFolder(workspaceId: string, replayId: string) {
  return `${workspaceId}/replays/${replayId}/`;
}

export function replayChunkKey(workspaceId: string, replayId: string, n: number) {
  return `${replayFolder(workspaceId, replayId)}${String(n).padStart(4, "0")}.json.gz`;
}

/** Milliseconds between the first and the last event of all chunks so far. */
export function spanOf(events: ReplayEvent[], startedAt: number | null): number {
  const last = Math.max(...events.map((event) => event.timestamp));
  const first = startedAt ?? Math.min(...events.map((event) => event.timestamp));
  return Math.max(0, Math.round(last - first));
}
