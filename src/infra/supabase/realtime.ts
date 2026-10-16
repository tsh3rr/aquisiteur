import type { RealtimePort } from "../types";

/**
 * Supabase Realtime broadcast (§6.4), without the SDK: the server publishes
 * through the REST endpoint with the secret key; browsers join a public
 * broadcast channel with the publishable key. Channel names carry an HMAC of
 * the topic, so only someone the app handed the name to can listen. Browsers
 * never publish (they talk to the app's routes), so a forged broadcast could
 * only reach the forger's own channel; clients refetch from the app anyway.
 */
export interface SupabaseRealtimeConfig {
  /** https://<project>.supabase.co */
  url: string;
  /** Publishable (or legacy anon) key, handed to browsers. */
  publishableKey: string;
  /** Secret (or legacy service_role) key, server only. */
  secretKey: string;
  /** Salt for the channel names. */
  secret: string;
}

const encoder = new TextEncoder();

async function channelName(secret: string, topic: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`aquisiteur-realtime:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(topic)));
  const hex = [...signature.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${topic}-${hex}`;
}

export function supabaseRealtime(config: SupabaseRealtimeConfig): RealtimePort {
  const base = config.url.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    apikey: config.secretKey,
    "content-type": "application/json",
  };
  // Legacy keys are JWTs and go into Authorization too; new sb_secret_ keys must not.
  if (config.secretKey.startsWith("eyJ")) headers.authorization = `Bearer ${config.secretKey}`;

  return {
    provider: "supabase",
    async publish(topic, event, payload) {
      const response = await fetch(`${base}/realtime/v1/api/broadcast`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: [
            { topic: await channelName(config.secret, topic), event, payload, private: false },
          ],
        }),
      });
      if (!response.ok) {
        // Realtime is best effort: clients refetch on reconnect. Log, never throw.
        console.error(`Supabase broadcast failed: ${response.status}`);
      }
    },
    async subscription(topic) {
      return {
        kind: "supabase",
        url: `${base.replace(/^http/, "ws")}/realtime/v1/websocket`,
        apiKey: config.publishableKey,
        topic: await channelName(config.secret, topic),
      };
    },
  };
}
