import { describe, expect, it } from "vitest";
import { cloudflareMetrics } from "./metrics";

const config = { accountId: "acc", token: "tok", workerName: "aquisiteur" };

describe("cloudflareMetrics", () => {
  it("asks for today's requests of the worker and converts CPU time to ms", async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const fetcher = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return Response.json({
        data: {
          viewer: {
            accounts: [
              {
                workersInvocationsAdaptive: [
                  {
                    sum: { requests: 1234, errors: 2 },
                    quantiles: { cpuTimeP50: 2500, cpuTimeP99: 8100 },
                  },
                ],
              },
            ],
          },
        },
      });
    }) as unknown as typeof fetch;
    const usage = await cloudflareMetrics(config, fetcher).usageToday(
      new Date("2026-10-16T13:30:00Z"),
    );
    expect(usage).toEqual({ requestsToday: 1234, errorsToday: 2, cpuMsP50: 2.5, cpuMsP99: 8.1 });
    const body = JSON.parse(String(sent!.init.body)) as { variables: Record<string, string> };
    expect(body.variables).toMatchObject({
      account: "acc",
      script: "aquisiteur",
      since: "2026-10-16T00:00:00.000Z",
    });
    expect(new Headers(sent!.init.headers).get("authorization")).toBe("Bearer tok");
  });

  it("returns null on errors instead of throwing", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await cloudflareMetrics(config, failing).usageToday()).toBeNull();
    const denied = (async () =>
      Response.json({ errors: [{ message: "not authorized" }] })) as unknown as typeof fetch;
    expect(await cloudflareMetrics(config, denied).usageToday()).toBeNull();
  });
});
