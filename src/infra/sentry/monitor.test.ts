import { describe, expect, it, vi } from "vitest";
import { sentryMonitor } from "./monitor";

describe("sentryMonitor", () => {
  it("sends an envelope to the EU ingest host with only the route", async () => {
    const fetcher = vi.fn(async () => new Response("{}"));
    const monitor = sentryMonitor(
      "https://pubkey@o123.ingest.de.sentry.io/456",
      { environment: "production", release: "abc" },
      fetcher as typeof fetch,
    );
    await monitor.captureException(new TypeError("boom"), {
      route: "/sites/[host]/x/[slug]",
      method: "GET",
      path: "/sites/[host]/x/[slug]",
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o123.ingest.de.sentry.io/api/456/envelope/");
    expect(new Headers(init.headers).get("x-sentry-auth")).toContain("sentry_key=pubkey");
    const [, item, raw] = String(init.body).split("\n");
    expect(JSON.parse(item!)).toEqual({ type: "event" });
    const event = JSON.parse(raw!);
    expect(event.environment).toBe("production");
    expect(event.exception.values[0]).toMatchObject({ type: "TypeError", value: "boom" });
    expect(event.request).toEqual({ method: "GET", url: "/sites/[host]/x/[slug]" });
    expect(raw).not.toMatch(/user|ip_address|cookie/i);
  });

  it("never throws when Sentry is unreachable", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    const monitor = sentryMonitor(
      "https://k@o1.ingest.de.sentry.io/2",
      { environment: "x" },
      fetcher as typeof fetch,
    );
    await expect(monitor.captureException("text", {})).resolves.toBeUndefined();
  });
});
