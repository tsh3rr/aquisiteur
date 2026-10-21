import "server-only";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { serverEnv } from "@/config/env";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getInfra } from "@/infra";
import { CLIENT_IP_HEADER } from "@/lib/client-ip";
import { sha256Hex } from "@/lib/crypto";
import { magicLinkEmail } from "./emails/magic-link";
import { hitRateLimit } from "./tracking/rate-limit";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 3;
/** Sign-in mails per address and hour, on top of Better Auth's per-IP limit. */
const MAGIC_LINKS_PER_ADDRESS = 6;

function isSignupAllowed(email: string): boolean {
  return serverEnv().SIGNUP_ALLOWLIST.includes(email.trim().toLowerCase());
}

function buildAuth() {
  const env = serverEnv();
  const db = getDb();
  const appUrl = new URL(env.APP_URL);

  return betterAuth({
    appName: "Aquisiteur",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [appUrl.origin],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        passkeys: schema.passkeys,
        rate_limits: schema.rateLimits,
      },
    }),
    user: { modelName: "users" },
    session: {
      modelName: "sessions",
      // Short-lived, rolling sessions (§10): expire after 3 days without use.
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
    },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    emailAndPassword: { enabled: false },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rate_limits",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/magic-link": { window: 600, max: 5 },
        "/passkey/*": { window: 60, max: 10 },
      },
    },
    advanced: {
      cookiePrefix: "aq",
      useSecureCookies: appUrl.protocol === "https:",
      // The one address the middleware trusts (src/lib/client-ip.ts).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    databaseHooks: {
      user: {
        create: {
          // No public registration in v1 (§9a): only allow-listed emails.
          before: async (user) => {
            if (!isSignupAllowed(user.email)) return false;
            return { data: user };
          },
        },
      },
      session: {
        create: {
          // IP addresses are not stored (§9); the user agent helps the owner
          // recognise their own devices.
          before: async (session) => ({ data: { ...session, ipAddress: null } }),
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          // Never reveal whether an address is known: unknown, non-allow-listed
          // addresses get the same response but no mail.
          const [existing] = await db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.email, email.toLowerCase()))
            .limit(1);
          if (!existing && !isSignupAllowed(email)) return;
          // Per address, whatever the client's IP: no mail flood with forged addresses.
          const key = `magic:${(await sha256Hex(email.trim().toLowerCase())).slice(0, 24)}`;
          if (!(await hitRateLimit(db, key, MAGIC_LINKS_PER_ADDRESS, 3600))) return;
          await getInfra().email.send({ to: email, ...magicLinkEmail({ url }) });
        },
      }),
      passkey({
        rpID: appUrl.hostname,
        rpName: "Aquisiteur",
        origin: appUrl.origin,
        schema: { passkey: { modelName: "passkeys" } },
      }),
      // Must stay last: lets server actions set auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof buildAuth>;

let pooled: Auth | undefined;
const perRequest = cache(buildAuth);

/** Better Auth instance bound to the right DB client for the hosting profile. */
export function getAuth(): Auth {
  if (getInfra().database.perRequestClient) return perRequest();
  pooled ??= buildAuth();
  return pooled;
}
