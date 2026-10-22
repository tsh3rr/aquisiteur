import { serverEnv } from "@/config/env";
import { manualLetters } from "./manual/letters";
import { cloudflareDatabase } from "./cloudflare/database";
import { cloudflareMetrics } from "./cloudflare/metrics";
import { logEmail } from "./dev/email";
import { fakeGeocoder } from "./dev/geocoder";
import { fakeVatCheck } from "./dev/vat-check";
import { consoleMonitor } from "./dev/monitor";
import { logPush } from "./dev/push";
import { memoryRealtime } from "./memory/realtime";
import { nominatimGeocoder } from "./nominatim/geocoder";
import { viesVatCheck } from "./vies/vat-check";
import { pingenLetters } from "./pingen/letters";
import { diskStorage } from "./disk/storage";
import { urlDatabase } from "./portable/database";
import { resendEmail } from "./resend/email";
import { s3Storage } from "./s3/storage";
import { sentryMonitor } from "./sentry/monitor";
import { supabaseRealtime } from "./supabase/realtime";
import type { EmailPort, Infra, PushPort, RealtimePort, StoragePort } from "./types";
import { webPush } from "./webpush/push";

export type * from "./types";

let cached: Infra | undefined;

/**
 * The only entry point domain code uses to reach provider-specific services.
 * Switching hosts means switching HOSTING_PROFILE (and adding adapters for
 * ports that still lack one), not touching feature code.
 */
export function getInfra(): Infra {
  if (cached) return cached;
  const env = serverEnv();

  const email: EmailPort =
    env.EMAIL_PROVIDER === "resend"
      ? resendEmail(required(env.RESEND_API_KEY, "RESEND_API_KEY"), env.EMAIL_FROM)
      : logEmail();

  const storage: StoragePort =
    env.STORAGE_PROVIDER === "s3"
      ? s3Storage({
          endpoint: required(env.S3_ENDPOINT, "S3_ENDPOINT"),
          bucket: required(env.S3_BUCKET, "S3_BUCKET"),
          accessKeyId: required(env.S3_ACCESS_KEY_ID, "S3_ACCESS_KEY_ID"),
          secretAccessKey: required(env.S3_SECRET_ACCESS_KEY, "S3_SECRET_ACCESS_KEY"),
          region: env.S3_REGION,
        })
      : diskStorage(env.LOCAL_STORAGE_DIR);
  if (
    env.STORAGE_PROVIDER === "local" &&
    env.HOSTING_PROFILE === "cloudflare" &&
    env.NODE_ENV === "production"
  ) {
    throw new Error("STORAGE_PROVIDER=local cannot persist files on Workers; configure S3/R2");
  }

  const realtime: RealtimePort =
    env.REALTIME_PROVIDER === "supabase"
      ? supabaseRealtime({
          url: required(env.SUPABASE_URL, "SUPABASE_URL"),
          publishableKey: required(env.SUPABASE_PUBLISHABLE_KEY, "SUPABASE_PUBLISHABLE_KEY"),
          secretKey: required(env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY"),
          secret: env.BETTER_AUTH_SECRET,
        })
      : memoryRealtime(env.BETTER_AUTH_SECRET);
  if (
    env.REALTIME_PROVIDER === "memory" &&
    env.HOSTING_PROFILE === "cloudflare" &&
    env.NODE_ENV === "production"
  ) {
    throw new Error("REALTIME_PROVIDER=memory cannot reach other Worker isolates; use supabase");
  }

  const push: PushPort =
    env.PUSH_PROVIDER === "webpush"
      ? webPush({
          publicKey: required(env.VAPID_PUBLIC_KEY, "VAPID_PUBLIC_KEY"),
          privateKey: required(env.VAPID_PRIVATE_KEY, "VAPID_PRIVATE_KEY"),
          subject: env.VAPID_SUBJECT,
        })
      : logPush(env.PUSH_LOG_FILE);

  cached = {
    profile: env.HOSTING_PROFILE,
    database:
      env.HOSTING_PROFILE === "cloudflare"
        ? cloudflareDatabase(env.DATABASE_URL)
        : urlDatabase(env.DATABASE_URL),
    email,
    storage,
    realtime,
    push,
    letters: (provider, config) => {
      if (provider === manualLetters.id) return manualLetters;
      if (provider === "pingen" && config?.provider === "pingen") {
        return pingenLetters(config, { storage });
      }
      return null;
    },
    vatCheck:
      env.VAT_CHECK_PROVIDER === "vies"
        ? viesVatCheck()
        : env.VAT_CHECK_PROVIDER === "fake"
          ? fakeVatCheck()
          : null,
    geocoder:
      env.GEOCODER_PROVIDER === "nominatim"
        ? nominatimGeocoder({ appUrl: env.APP_URL, contact: env.GEOCODER_CONTACT })
        : env.GEOCODER_PROVIDER === "fake"
          ? fakeGeocoder()
          : null,
    monitor: env.SENTRY_DSN
      ? sentryMonitor(env.SENTRY_DSN, {
          environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
          release: env.SENTRY_RELEASE,
        })
      : consoleMonitor(),
    hostingMetrics:
      env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ANALYTICS_TOKEN
        ? cloudflareMetrics({
            accountId: env.CLOUDFLARE_ACCOUNT_ID,
            token: env.CLOUDFLARE_ANALYTICS_TOKEN,
            workerName: env.CLOUDFLARE_WORKER_NAME,
          })
        : null,
  };
  return cached;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} must be set`);
  return value;
}
