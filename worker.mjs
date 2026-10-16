/**
 * Cloudflare entry point: the OpenNext worker plus a cron trigger for the
 * hourly jobs (wrangler.jsonc "triggers"). The scheduled handler calls the
 * job route through the app itself, so jobs run with the same code and
 * bindings as requests. See docs/DECISIONS.md ADR-0032.
 */
import handler from "./.open-next/worker.js";

const worker = {
  fetch: handler.fetch,
  async scheduled(_controller, env, ctx) {
    const url = new URL("/api/jobs/hourly", env.APP_URL);
    const request = new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}`, host: url.host },
    });
    const response = await handler.fetch(request, env, ctx);
    console.log("hourly jobs", response.status, await response.text());
  },
};

export default worker;

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
