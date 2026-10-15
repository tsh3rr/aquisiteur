import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { DatabasePort } from "../types";

/**
 * Postgres via Cloudflare Hyperdrive. Hyperdrive pools connections at the
 * edge, so every request opens its own (cheap) client.
 */
export function cloudflareDatabase(fallbackUrl: string | undefined): DatabasePort {
  return {
    perRequestClient: true,
    connectionString() {
      const { env } = getCloudflareContext();
      const hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
      const url = hyperdrive?.connectionString ?? fallbackUrl;
      if (!url) throw new Error("No HYPERDRIVE binding and no DATABASE_URL configured");
      return url;
    },
  };
}
