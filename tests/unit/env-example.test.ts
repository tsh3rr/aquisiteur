import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `cp .env.example .env` must give a bootable configuration: empty optional
 * values (e.g. `SENTRY_DSN=`) may not fail validation.
 */
const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  vi.resetModules();
});

describe(".env.example", () => {
  it("parses as a valid server environment", async () => {
    const example = parse(readFileSync(".env.example", "utf8"));
    process.env = { ...example, NODE_ENV: "development" } as NodeJS.ProcessEnv;
    const { serverEnv } = await import("@/config/env");
    const env = serverEnv();
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.HOSTING_PROFILE).toBe("node");
  });
});
