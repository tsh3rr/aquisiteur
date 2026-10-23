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
  /** Extra headers, e.g. `Message-ID` so replies can be matched later. */
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

export interface EmailPort {
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

/** What a delivery webhook reports about a sent mail (phase 7c-2). */
export interface EmailEvent {
  /** The id `EmailPort.send` returned. */
  providerId: string;
  status: "sent" | "delivered" | "delayed" | "bounced" | "complained" | "failed";
  at: Date;
  /** Bounce or failure reason, when the provider gives one. */
  detail: string | null;
}

/**
 * Verifies and reads the provider's delivery webhook. Throws an error with
 * `status` 401 for a bad signature. Unknown event types (later also inbound
 * mail) come back as an empty list.
 */
export interface EmailWebhookPort {
  parse(body: string, headers: Headers): Promise<EmailEvent[]>;
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
  /** Removes every object under `prefix` (must end in "/"); returns how many. */
  deletePrefix(prefix: string): Promise<number>;
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
  envelope: "DL";
  /** Asset ids of enclosed PDFs. */
  inserts: string[];
}

export interface LetterDispatchRequest {
  letterId: string;
  workspaceId: string;
  /** Storage key of the print-ready PDF; null for `manual`, where the owner prints. */
  pdfKey: string | null;
  options: LetterPrintOptions;
  /** Same key for retries of the same letter (print APIs dedupe on it). */
  idempotencyKey: string;
}

/** A status change a provider reports (webhook or status query). */
export interface LetterProviderUpdate {
  providerRef: string;
  status: LetterStatus;
  /** When it happened at the provider. */
  at: Date;
  /** What the provider charges for the letter, once known. */
  costCents: number | null;
  /** A problem the provider reports, in its own words (why it failed, or what needs fixing). */
  reason: string | null;
}

export interface LetterDispatchProvider {
  readonly id: string;
  /**
   * True when the provider reports printing and posting itself (webhooks).
   * False for `manual`: the owner marks the letter as posted.
   */
  readonly tracksDelivery: boolean;
  send(letter: LetterDispatchRequest): Promise<{ providerRef: string }>;
  /** Null when the provider does not know or the state does not map. */
  getStatus(
    providerRef: string,
  ): Promise<{ status: LetterStatus; costCents: number | null } | null>;
  cancel(providerRef: string): Promise<void>;
  /** Null when the provider has no price list (the workspace setting applies). */
  estimateCost(
    letter: Pick<LetterDispatchRequest, "options"> & { country?: string; pages?: number },
  ): Promise<{ cents: number } | null>;
  /** Verifies the credentials; throws with a message for the owner when they do not work. */
  checkConnection?(): Promise<{ name: string }>;
  /**
   * Verifies and parses a status webhook; throws on a bad signature. The
   * caller reads the body with a size limit (`readBodyLimited`).
   */
  handleWebhook?(body: Uint8Array<ArrayBuffer>, headers: Headers): Promise<LetterProviderUpdate[]>;
}

/** Credentials of a workspace's print provider (§7.9), decrypted by the app. */
export type LetterProviderConfig = {
  provider: "pingen";
  organisationId: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string | null;
  staging: boolean;
};

/** Everything the app can ask the hosting environment for. */
/** A postal address to place on the map (§7.8 „Karte“). */
export interface GeocodeQuery {
  street: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

export interface GeocoderPort {
  readonly id: string;
  /** Pause between two calls the provider asks for (Nominatim: 1 s). */
  readonly minIntervalMs: number;
  /** Null when the address cannot be found; throws on provider errors. */
  geocode(query: GeocodeQuery): Promise<{ latitude: number; longitude: number } | null>;
}

/**
 * Phase 7c: EU VAT id check (VIES) for reverse charge (§7.10). With the
 * requester's own UID, VIES returns a consultation number as proof.
 */
export interface VatCheckResult {
  valid: boolean;
  /** As registered, when the member state discloses it. */
  name: string | null;
  address: string | null;
  /** VIES request identifier, only with a requester UID. */
  consultationNumber: string | null;
  checkedAt: Date;
}

export interface VatCheckPort {
  readonly id: string;
  /** Throws when VIES or the member state's service is unavailable. */
  check(input: { vatId: string; requesterVatId?: string | null }): Promise<VatCheckResult>;
}

/**
 * Phase 6: error monitoring (§10 „Sentry EU“). Only the error, the route and
 * the request method and path leave the app: no query strings, bodies,
 * headers, cookies or IP addresses.
 */
export interface MonitorPort {
  captureException(
    error: unknown,
    context: { route?: string; method?: string; path?: string; kind?: string },
  ): Promise<void>;
}

/** Request and CPU figures of the hosting platform, for Settings → System (§5a). */
export interface HostingUsage {
  /** Requests since midnight UTC. */
  requestsToday: number;
  errorsToday: number;
  /** CPU time per request in milliseconds over the same window. */
  cpuMsP50: number;
  cpuMsP99: number;
}

export interface HostingMetricsPort {
  /** Null when the provider cannot be reached; never throws. */
  usageToday(now?: Date): Promise<HostingUsage | null>;
}

export interface Infra {
  readonly profile: HostingProfile;
  readonly database: DatabasePort;
  readonly email: EmailPort;
  /** Null without a webhook secret (and with the log provider). */
  readonly emailWebhook: EmailWebhookPort | null;
  readonly storage: StoragePort;
  readonly realtime: RealtimePort;
  readonly push: PushPort;
  /**
   * Letter dispatch providers by id; `manual` always exists. Print APIs
   * need the workspace's credentials and are null without them.
   */
  letters(provider: string, config?: LetterProviderConfig | null): LetterDispatchProvider | null;
  /** Null when the VAT id check is switched off (VAT_CHECK_PROVIDER=none). */
  vatCheck: VatCheckPort | null;
  /** Null when geocoding is switched off (GEOCODER_PROVIDER=none). */
  geocoder: GeocoderPort | null;
  monitor: MonitorPort;
  /** Null when no analytics access is configured. */
  hostingMetrics: HostingMetricsPort | null;
}
