import type { MonitorPort } from "../types";

/**
 * Sends errors to Sentry (EU region, e.g. `https://…@o0.ingest.de.sentry.io/1`)
 * through its envelope endpoint with plain fetch. No SDK: it would add
 * hundreds of KiB to the Worker (ADR-0035) and collect more than we want.
 * Personal data is never sent; see MonitorPort.
 */
export function sentryMonitor(
  dsn: string,
  options: { environment: string; release?: string },
  fetcher: typeof fetch = fetch,
): MonitorPort {
  const url = new URL(dsn);
  const projectId = url.pathname.replace(/^\//, "");
  const endpoint = `${url.protocol}//${url.host}/api/${projectId}/envelope/`;
  const auth = `Sentry sentry_version=7, sentry_client=aquisiteur/1, sentry_key=${url.username}`;

  return {
    async captureException(error, context) {
      const err = error instanceof Error ? error : new Error(String(error));
      const eventId = crypto.randomUUID().replace(/-/g, "");
      const event = {
        event_id: eventId,
        timestamp: Date.now() / 1000,
        platform: "javascript",
        level: "error",
        environment: options.environment,
        ...(options.release ? { release: options.release } : {}),
        tags: { kind: context.kind ?? "server", route: context.route ?? "unknown" },
        request: context.path ? { method: context.method, url: context.path } : undefined,
        exception: {
          values: [
            {
              type: err.name,
              value: err.message.slice(0, 1000),
              stacktrace: err.stack ? { frames: parseStack(err.stack) } : undefined,
            },
          ],
        },
      };
      const body = [
        JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
        JSON.stringify({ type: "event" }),
        JSON.stringify(event),
      ].join("\n");
      await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": auth },
        body,
      }).catch(() => undefined);
    },
  };
}

/** Minimal V8 stack parsing; Sentry expects the innermost frame last. */
function parseStack(stack: string) {
  return stack
    .split("\n")
    .slice(1, 30)
    .map((line) => {
      const match = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
      return match
        ? {
            function: match[1] ?? "?",
            filename: match[2],
            lineno: Number(match[3]),
            colno: Number(match[4]),
          }
        : { function: line.trim() };
    })
    .reverse();
}
