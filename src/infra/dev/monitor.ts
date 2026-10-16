import type { MonitorPort } from "../types";

/** Without SENTRY_DSN: errors go to the server log only. */
export function consoleMonitor(): MonitorPort {
  return {
    async captureException(error, context) {
      console.error("[monitor]", context.route ?? context.path ?? "", error);
    },
  };
}
