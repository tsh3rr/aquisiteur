/**
 * Provider-neutral ports. Domain code depends on these interfaces only; the
 * concrete adapters live next to this file (one folder per provider) and are
 * wired up in ./index.ts. See docs/HOSTING.md and docs/DECISIONS.md (ADR-0003).
 *
 * Ports that are not implemented yet are declared here anyway so later phases
 * slot into a fixed shape. Their phase is noted on each interface.
 */

/** Which hosting profile the process runs under. Selected via HOSTING_PROFILE. */
export type HostingProfile = "cloudflare" | "node";

/** How the app reaches Postgres. */
export interface DatabasePort {
  /** Connection string for the current request (Hyperdrive on Cloudflare). */
  connectionString(): string;
  /**
   * True when a client must not outlive the request (Workers forbid sharing
   * I/O objects across requests). False allows a process-wide pool.
   */
  readonly perRequestClient: boolean;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Overrides the default sender, e.g. a workspace's verified sender domain. */
  from?: string;
  replyTo?: string;
}

export interface EmailPort {
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

export interface RateLimitResult {
  success: boolean;
}

/** Phase 2: short-link resolver and event ingestion. Auth uses Better Auth's DB-backed limiter. */
export interface RateLimiterPort {
  /** Consumes one unit for `key` within the limiter's configured window. */
  limit(key: string): Promise<RateLimitResult>;
}

/** Exposé assets and uploads. Keys always start with the workspace id (§9a). */
export interface StoragePort {
  put(
    key: string,
    body: Uint8Array,
    options: { contentType: string; cacheControl?: string },
  ): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null>;
  delete(key: string): Promise<void>;
}

/** Phase 4: notifications, digests, retention, score recomputation. */
export interface JobQueuePort {
  enqueue<T extends JobName>(
    name: T,
    payload: JobPayloads[T],
    options?: { delaySeconds?: number; dedupeKey?: string },
  ): Promise<void>;
}

export interface JobPayloads {
  "notification.dispatch": { workspaceId: string; notificationId: string };
  "intent.recompute": { workspaceId: string; prospectId: string };
  "digest.daily": { workspaceId: string };
  "retention.sweep": { workspaceId: string };
}
export type JobName = keyof JobPayloads;

/** Small key/value cache, e.g. resolved hosts or short-link lookups (phase 2). */
export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * How a browser listens on a topic. `sse`: an EventSource on the app's own
 * live route (`token` authorises the topic). `supabase`: a Supabase Realtime
 * broadcast channel with an unguessable name.
 */
export type RealtimeSubscription =
  { kind: "sse"; token: string } | { kind: "supabase"; url: string; apiKey: string; topic: string };

/**
 * Phase 3: live chat and cockpit live feed (§6.4). Browsers only listen;
 * everything they say goes through the app's routes, which publish here.
 * Topics are `ws-<workspaceId>` (cockpit) and `chat-<threadId>` (visitor).
 */
export interface RealtimePort {
  readonly provider: "memory" | "supabase";
  publish(topic: string, event: string, payload: unknown): Promise<void>;
  /** What a browser needs to listen on `topic`. The caller has authorised it. */
  subscription(topic: string): Promise<RealtimeSubscription>;
  /**
   * The event stream behind the `sse` subscription, or null for an invalid
   * token. Only the in-process adapter serves streams itself.
   */
  stream?(token: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null>;
}

/** Phase 6 / SaaS: TLS for workspace custom domains (Cloudflare for SaaS). */
export interface DomainPort {
  register(hostname: string): Promise<{ providerRef: string }>;
  status(providerRef: string): Promise<"pending" | "active" | "failed">;
  remove(providerRef: string): Promise<void>;
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/** Phase 4: Web Push (VAPID) to the owner's devices. */
export interface PushPort {
  /** VAPID public key browsers subscribe with; null when push is not configured. */
  readonly publicKey: string | null;
  send(
    subscription: { endpoint: string; keys: PushSubscriptionKeys },
    payload: {
      title: string;
      body: string;
      url: string;
      tag?: string;
      renotify?: boolean;
      actions?: { action: string; title: string; url: string }[];
    },
  ): Promise<{ gone: boolean }>;
}

/** Phase 5: printed letters. `manual` is the first provider (§7.9). */
export type LetterStatus =
  "draft" | "queued" | "submitted" | "printed" | "posted" | "returned" | "failed" | "cancelled";

export interface LetterPrintOptions {
  color: boolean;
  duplex: boolean;
  shipping: "standard" | "priority";
  envelope: "DL" | "C5" | "C4";
  attachments: number;
}

export interface LetterDispatchRequest {
  letterId: string;
  workspaceId: string;
  pdf: Uint8Array;
  options: LetterPrintOptions;
}

export interface LetterDispatchProvider {
  readonly id: string;
  send(letter: LetterDispatchRequest): Promise<{ providerRef: string }>;
  getStatus(providerRef: string): Promise<LetterStatus>;
  cancel(providerRef: string): Promise<void>;
  estimateCost(letter: Pick<LetterDispatchRequest, "options">): Promise<{ cents: number }>;
  handleWebhook?(request: Request): Promise<{ providerRef: string; status: LetterStatus }[]>;
}

/** Everything the app can ask the hosting environment for. */
export interface Infra {
  readonly profile: HostingProfile;
  readonly database: DatabasePort;
  readonly email: EmailPort;
  readonly storage: StoragePort;
  readonly realtime: RealtimePort;
  readonly push: PushPort;
}
