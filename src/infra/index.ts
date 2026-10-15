import { serverEnv } from "@/config/env";
import { cloudflareDatabase } from "./cloudflare/database";
import { logEmail } from "./dev/email";
import { urlDatabase } from "./portable/database";
import { resendEmail } from "./resend/email";
import type { EmailPort, Infra } from "./types";

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

  cached = {
    profile: env.HOSTING_PROFILE,
    database:
      env.HOSTING_PROFILE === "cloudflare"
        ? cloudflareDatabase(env.DATABASE_URL)
        : urlDatabase(env.DATABASE_URL),
    email,
  };
  return cached;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} must be set`);
  return value;
}
