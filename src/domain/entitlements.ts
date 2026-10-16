/**
 * Plans & limits (§9a). Every limitable feature asks entitlements() first.
 * v1 has no billing, so every workspace gets the unlimited plan; a SaaS plan
 * table plugs in here later without changing callers.
 */
export interface Entitlements {
  plan: "unlimited";
  features: {
    customDomains: boolean;
    sessionReplay: boolean;
    letterDispatchApi: boolean;
    apiTokens: boolean;
  };
  limits: {
    /** null means unlimited. */
    publishedExposes: number | null;
    monthlyVisits: number | null;
    members: number | null;
    storageBytes: number | null;
  };
}

const unlimited: Entitlements = {
  plan: "unlimited",
  features: {
    customDomains: true,
    sessionReplay: true,
    letterDispatchApi: true,
    apiTokens: true,
  },
  limits: {
    publishedExposes: null,
    monthlyVisits: null,
    members: null,
    storageBytes: null,
  },
};

export function entitlements(_workspace: { id: string }): Entitlements {
  return unlimited;
}

/** True when `used + increment` stays within `limit` (null = unlimited). */
export function withinLimit(limit: number | null, used: number, increment = 1): boolean {
  return limit === null || used + increment <= limit;
}
