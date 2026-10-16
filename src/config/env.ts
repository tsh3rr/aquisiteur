import { z } from "zod";

/**
 * Server-side configuration. Everything deployment-specific comes from env
 * variables (documented in .env.example); everything workspace-specific lives
 * in the database (workspace_settings), never here.
 */
const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOSTING_PROFILE: z.enum(["cloudflare", "node"]).default("node"),
  DATABASE_URL: z.string().min(1).optional(),
  /** Public origin of the cockpit, e.g. https://app.aquisiteur.app */
  APP_URL: z.url(),
  /** Workspaces get <slug>.<PLATFORM_DOMAIN> as fallback host for exposés and short links. */
  PLATFORM_DOMAIN: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Emails allowed to create an account. No public sign-up in v1 (§9a). */
  SIGNUP_ALLOWLIST: csv,
  EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
  EMAIL_FROM: z.string().default("Aquisiteur <noreply@aquisiteur.app>"),
  RESEND_API_KEY: z.string().optional(),
  /** `local` writes to LOCAL_STORAGE_DIR (dev, tests); `s3` uses any S3 API, in production R2. */
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
  S3_ENDPOINT: z
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  /**
   * Live chat and live feed (§6.4). `memory`: in-process Server-Sent Events
   * (dev, tests, a single Node instance). `supabase`: Supabase Realtime
   * broadcast, required on Workers.
   */
  REALTIME_PROVIDER: z.enum(["memory", "supabase"]).default("memory"),
  SUPABASE_URL: z
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  /**
   * Owner notifications (§7.7). `log`: print (and append to PUSH_LOG_FILE),
   * dev and tests. `webpush`: Web Push with the VAPID key pair from
   * `pnpm push:keys`.
   */
  PUSH_PROVIDER: z.enum(["log", "webpush"]).default("log"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:noreply@aquisiteur.app"),
  PUSH_LOG_FILE: z.string().optional(),
  /**
   * Places prospects on the map (§7.8). `nominatim`: OpenStreetMap's
   * Nominatim, at most one request per second, from the hourly job.
   * `fake`: deterministic points for tests. `none`: no map positions.
   */
  GEOCODER_PROVIDER: z.enum(["none", "fake", "nominatim"]).default("nominatim"),
  /** Contact address sent to Nominatim, as its usage policy asks. */
  GEOCODER_CONTACT: z.string().optional(),
  /**
   * Error monitoring (Sentry, EU region: the DSN host ends in ingest.de.sentry.io).
   * Unset: errors go to the server log only.
   */
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  /** Bearer secret for /api/jobs/* (cron: digest). Unset disables the endpoint. */
  CRON_SECRET: z.string().min(24).optional(),
  /** base64-encoded 32-byte key for integration secrets (AES-256-GCM). */
  INTEGRATIONS_ENCRYPTION_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = serverEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Host (with port) of the cockpit, lower-cased. */
export function appHost(): string {
  return new URL(serverEnv().APP_URL).host.toLowerCase();
}
