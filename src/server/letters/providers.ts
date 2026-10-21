import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { serverEnv } from "@/config/env";
import type { Database, Transaction } from "@/db";
import { auditLog, integrations, letters } from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { getInfra, type LetterDispatchProvider, type LetterProviderConfig } from "@/infra";
import { decryptSecret, encryptSecret, importSecretKey } from "@/lib/crypto";

/**
 * The workspace's print provider (§7.9 „Zugangsdaten pro Workspace
 * verschlüsselt“). Pingen's ids sit in `integrations.config`; client secret
 * and webhook signing key are encrypted with INTEGRATIONS_ENCRYPTION_KEY,
 * bound to the workspace, and never leave the server.
 */

export const PINGEN_KIND = "letters.pingen";

const configSchema = z.object({
  enabled: z.boolean().default(false),
  organisationId: z.string().default(""),
  clientId: z.string().default(""),
  staging: z.boolean().default(true),
});
const secretsSchema = z.object({
  clientSecret: z.string().default(""),
  webhookSecret: z.string().nullable().default(null),
});

export interface PingenSettingsView {
  enabled: boolean;
  organisationId: string;
  clientId: string;
  staging: boolean;
  hasClientSecret: boolean;
  hasWebhookSecret: boolean;
  /** False when the server has no INTEGRATIONS_ENCRYPTION_KEY: secrets cannot be stored. */
  canStoreSecrets: boolean;
}

const context = (workspaceId: string) => `${workspaceId}:${PINGEN_KIND}`;

async function encryptionKey() {
  const raw = serverEnv().INTEGRATIONS_ENCRYPTION_KEY;
  return raw ? importSecretKey(raw) : null;
}

type Reader = Database | Transaction;

async function row(db: Reader, workspaceId: string) {
  const [found] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.kind, PINGEN_KIND)));
  return found ?? null;
}

async function secretsOf(workspaceId: string, ciphertext: string | null) {
  const key = await encryptionKey();
  if (!key || !ciphertext) return secretsSchema.parse({});
  return secretsSchema.parse(
    JSON.parse(await decryptSecret(key, ciphertext, context(workspaceId))),
  );
}

export async function loadPingenSettings(
  tx: Transaction,
  workspaceId: string,
): Promise<PingenSettingsView> {
  const found = await row(tx, workspaceId);
  const config = configSchema.parse(found?.config ?? {});
  const secrets = await secretsOf(workspaceId, found?.secretCiphertext ?? null).catch(() =>
    secretsSchema.parse({}),
  );
  return {
    ...config,
    hasClientSecret: secrets.clientSecret !== "",
    hasWebhookSecret: Boolean(secrets.webhookSecret),
    canStoreSecrets: Boolean(serverEnv().INTEGRATIONS_ENCRYPTION_KEY),
  };
}

export interface PingenSettingsInput {
  enabled: boolean;
  organisationId: string;
  clientId: string;
  staging: boolean;
  /** Empty: keep the stored one. */
  clientSecret: string;
  webhookSecret: string;
}

export async function savePingenSettings(
  tx: Transaction,
  actor: Actor,
  input: PingenSettingsInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = await encryptionKey();
  if (!key) {
    return {
      ok: false,
      message:
        "Auf dem Server fehlt INTEGRATIONS_ENCRYPTION_KEY, deshalb können keine Zugangsdaten gespeichert werden.",
    };
  }
  const found = await row(tx, actor.workspaceId);
  const previous = await secretsOf(actor.workspaceId, found?.secretCiphertext ?? null);
  const secrets = {
    clientSecret: input.clientSecret || previous.clientSecret,
    webhookSecret: input.webhookSecret || previous.webhookSecret,
  };
  const config = {
    enabled: input.enabled,
    organisationId: input.organisationId,
    clientId: input.clientId,
    staging: input.staging,
  };
  if (config.enabled && (!config.organisationId || !config.clientId || !secrets.clientSecret)) {
    return {
      ok: false,
      message: "Zum Einschalten braucht Pingen Organisations-ID, Client-ID und Client-Secret.",
    };
  }
  const secretCiphertext = await encryptSecret(
    key,
    JSON.stringify(secrets),
    context(actor.workspaceId),
  );
  await tx
    .insert(integrations)
    .values({ workspaceId: actor.workspaceId, kind: PINGEN_KIND, config, secretCiphertext })
    .onConflictDoUpdate({
      target: [integrations.workspaceId, integrations.kind],
      set: { config, secretCiphertext, updatedAt: new Date() },
    });
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "integration.updated",
    targetType: "workspace",
    targetId: actor.workspaceId,
    meta: { kind: PINGEN_KIND, enabled: config.enabled, staging: config.staging },
  });
  return { ok: true };
}

/**
 * Whether recipients' addresses go, or went, to Pingen: switched on, or a real
 * (not test) letter was sent through it. No secrets are read (privacy page).
 */
export async function printServiceOf(db: Reader, workspaceId: string): Promise<"pingen" | null> {
  const found = await row(db, workspaceId);
  if (found && configSchema.parse(found.config).enabled) return "pingen";
  const [sent] = await db
    .select({ id: letters.id })
    .from(letters)
    .where(and(eq(letters.workspaceId, workspaceId), eq(letters.provider, "pingen")))
    .limit(1);
  return sent ? "pingen" : null;
}

/** Decrypted credentials, or null when Pingen is not set up (or not switched on). */
async function pingenConfig(
  db: Reader,
  workspaceId: string,
  options: { requireEnabled: boolean },
): Promise<LetterProviderConfig | null> {
  const found = await row(db, workspaceId);
  if (!found) return null;
  const config = configSchema.parse(found.config);
  if (options.requireEnabled && !config.enabled) return null;
  const secrets = await secretsOf(workspaceId, found.secretCiphertext);
  if (!config.organisationId || !config.clientId || !secrets.clientSecret) return null;
  return {
    provider: "pingen",
    organisationId: config.organisationId,
    clientId: config.clientId,
    clientSecret: secrets.clientSecret,
    webhookSecret: secrets.webhookSecret,
    staging: config.staging,
  };
}

/**
 * The provider a letter was sent with. Credentials are loaded even when the
 * owner has switched Pingen off since, so letters on their way can still be
 * tracked and cancelled. `pingen-staging` letters always talk to Pingen's test
 * environment, whatever the setting is now; plain `pingen` means the setting.
 */
export async function letterProvider(
  db: Reader,
  workspaceId: string,
  provider: string,
): Promise<LetterDispatchProvider | null> {
  if (provider !== "pingen" && provider !== "pingen-staging") {
    return getInfra().letters(provider);
  }
  const config = await pingenConfig(db, workspaceId, { requireEnabled: false });
  if (!config) return null;
  return getInfra().letters("pingen", {
    ...config,
    staging: provider === "pingen-staging" ? true : config.staging,
  });
}

/** The print API new letters go to, or null when the owner prints them. */
export async function activePrintProvider(
  db: Reader,
  workspaceId: string,
): Promise<LetterDispatchProvider | null> {
  const config = await pingenConfig(db, workspaceId, { requireEnabled: true });
  return config ? getInfra().letters("pingen", config) : null;
}

/** Tries the stored credentials with a harmless request (Settings → „Verbindung testen“). */
export async function testPingenConnection(
  tx: Transaction,
  workspaceId: string,
): Promise<{ ok: boolean; message: string }> {
  const config = await pingenConfig(tx, workspaceId, { requireEnabled: false });
  const provider = config ? getInfra().letters("pingen", config) : null;
  if (!provider?.checkConnection) {
    return { ok: false, message: "Bitte zuerst Organisations-ID, Client-ID und Secret speichern." };
  }
  try {
    const { name } = await provider.checkConnection();
    return {
      ok: true,
      message: `Verbunden${name ? ` mit „${name}“` : ""}${config!.staging ? " (Testumgebung)" : ""}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Pingen ist nicht erreichbar.",
    };
  }
}
