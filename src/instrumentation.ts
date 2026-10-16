import type { Instrumentation } from "next";

/**
 * Server errors go to the monitor port (Sentry EU when SENTRY_DSN is set,
 * ADR-0044). Only the route pattern is sent, never the concrete path: it can
 * contain a prospect's exposé address.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // The edge bundle (middleware) must not see @/infra; this check is inlined at build time.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getInfra } = await import("@/infra");
    await getInfra().monitor.captureException(error, {
      route: context.routePath,
      method: request.method,
      path: context.routePath,
      kind: `${context.routerKind}:${context.routeType}`,
    });
  }
};
