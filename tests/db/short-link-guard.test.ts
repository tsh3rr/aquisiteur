import { like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/db/client";
import * as schema from "@/db/schema";
import {
  clientKey,
  MISS_LIMIT,
  recordMiss,
  shortLinksBlocked,
  typedCodesBlocked,
  WORKSPACE_MISS_LIMIT,
} from "@/server/tracking/short-link-guard";

/** §10: short links are rate-limited against enumeration, per client and workspace. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });
const ws = "00000000-0000-4000-8000-0000000000aa";

afterAll(async () => {
  await close();
});

describe("short-link guard", () => {
  it("blocks a client after too many unknown codes, but not others", async () => {
    const guesser = await clientKey(new Headers({ "x-aquisiteur-client-ip": "203.0.113.7" }));
    const reader = await clientKey(new Headers({ "x-aquisiteur-client-ip": "198.51.100.2" }));
    expect(guesser).not.toBe(reader);
    for (let i = 0; i < MISS_LIMIT.count; i++) {
      expect(await recordMiss(db, ws, guesser)).toBe(true);
    }
    expect(await shortLinksBlocked(db, ws, guesser)).toBe(true);
    expect(await recordMiss(db, ws, guesser)).toBe(false);
    expect(await shortLinksBlocked(db, ws, reader)).toBe(false);
  });

  it("treats one IPv6 /64 network as one client", async () => {
    const key = (ip: string) => clientKey(new Headers({ "x-aquisiteur-client-ip": ip }));
    expect(await key("2001:db8:aa:1::1")).toBe(await key("2001:db8:aa:1:ffff:1234:5678:9abc"));
    expect(await key("2001:db8:aa:1::1")).not.toBe(await key("2001:db8:aa:2::1"));
  });

  it("blocks typed codes for the whole workspace after too many misses from any address", async () => {
    const workspace = "00000000-0000-4000-8000-0000000000ab";
    for (let i = 0; i < WORKSPACE_MISS_LIMIT.count; i++) {
      const client = await clientKey(
        new Headers({ "x-aquisiteur-client-ip": `198.51.100.${i % 250}` }),
      );
      await recordMiss(db, workspace, client);
    }
    expect(await typedCodesBlocked(db, workspace)).toBe(true);
    expect(await typedCodesBlocked(db, ws)).toBe(false);
  });

  it("never stores the IP address", async () => {
    const rows = await db
      .select({ key: schema.rateLimits.key })
      .from(schema.rateLimits)
      .where(like(schema.rateLimits.key, "aq:miss:%"));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
  });
});
