import type { DatabasePort } from "../types";

/** Plain DATABASE_URL with a process-wide pool (node profile, scripts, tests). */
export function urlDatabase(url: string | undefined): DatabasePort {
  return {
    perRequestClient: false,
    connectionString() {
      if (!url) throw new Error("DATABASE_URL is not configured");
      return url;
    },
  };
}
