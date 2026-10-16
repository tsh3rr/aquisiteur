import { serverEnv } from "@/config/env";
import { cloudflareDatabase } from "./cloudflare/database";
import { logEmail } from "./dev/email";
import { memoryRealtime } from "./memory/realtime";
import { localStorage } from "./dev/storage";
import { urlDatabase } from "./portable/database";
import { resendEmail } from "./resend/email";
import { s3Storage } from "./s3/storage";
import { supabaseRealtime } from "./supabase/realtime";
import type { EmailPort, Infra, RealtimePort, StoragePort } from "./types";

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
      : localStorage(env.LOCAL_STORAGE_DIR);
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

  cached = {
    profile: env.HOSTING_PROFILE,
    database:
      env.HOSTING_PROFILE === "cloudflare"
        ? cloudflareDatabase(env.DATABASE_URL)
        : urlDatabase(env.DATABASE_URL),
    email,
    storage,
    realtime,
  };
  return cached;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} must be set`);
  return value;
}
