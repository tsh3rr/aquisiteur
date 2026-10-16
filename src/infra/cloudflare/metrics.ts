import type { HostingMetricsPort, HostingUsage } from "../types";

/**
 * Requests and CPU time of the Worker from Cloudflare's GraphQL Analytics
 * API (§5a). Needs an API token with "Account Analytics: Read". Any failure
 * yields null so the settings page still renders.
 */

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

const QUERY = `query Usage($account: string!, $script: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(
        limit: 1
        filter: { scriptName: $script, datetime_geq: $since, datetime_leq: $until }
      ) {
        sum { requests errors }
        quantiles { cpuTimeP50 cpuTimeP99 }
      }
    }
  }
}`;

interface Response {
  data?: {
    viewer?: {
      accounts?: {
        workersInvocationsAdaptive?: {
          sum?: { requests?: number; errors?: number };
          quantiles?: { cpuTimeP50?: number; cpuTimeP99?: number };
        }[];
      }[];
    };
  };
  errors?: unknown[] | null;
}

export function cloudflareMetrics(
  config: { accountId: string; token: string; workerName: string },
  fetcher: typeof fetch = fetch,
): HostingMetricsPort {
  return {
    async usageToday(now = new Date()): Promise<HostingUsage | null> {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      try {
        const response = await fetcher(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query: QUERY,
            variables: {
              account: config.accountId,
              script: config.workerName,
              since: since.toISOString(),
              until: now.toISOString(),
            },
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as Response;
        if (body.errors?.length) return null;
        const accounts = body.data?.viewer?.accounts;
        if (!accounts?.length) return null;
        const row = accounts[0]?.workersInvocationsAdaptive?.[0];
        // CPU quantiles arrive in microseconds.
        return {
          requestsToday: row?.sum?.requests ?? 0,
          errorsToday: row?.sum?.errors ?? 0,
          cpuMsP50: (row?.quantiles?.cpuTimeP50 ?? 0) / 1000,
          cpuMsP99: (row?.quantiles?.cpuTimeP99 ?? 0) / 1000,
        };
      } catch {
        return null;
      }
    },
  };
}
