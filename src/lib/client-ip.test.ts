import { describe, expect, it } from "vitest";
import { clientIp, ORIGIN_HEADER, originSecretValid, rateLimitBucket } from "./client-ip";

describe("clientIp()", () => {
  it("prefers Cloudflare's header over x-forwarded-for", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.2, 10.0.0.1",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }))).toBe(
      "198.51.100.2",
    );
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe("rateLimitBucket()", () => {
  it("keeps IPv4 addresses", () => {
    expect(rateLimitBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitBucket(null)).toBe("unknown");
  });

  it("groups IPv6 addresses by their /64 network", () => {
    const a = rateLimitBucket("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2001:db8:1234:5678::/64");
    expect(rateLimitBucket("2001:0DB8:1234:5678::1")).toBe(a);
    expect(rateLimitBucket("[2001:db8:1234:5678::2]")).toBe(a);
    expect(rateLimitBucket("2001:db8:1234:5679::1")).not.toBe(a);
    expect(rateLimitBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitBucket("::1")).toBe("0:0:0:0::/64");
  });
});

describe("originSecretValid()", () => {
  it("accepts only the exact secret", () => {
    const secret = "s3cret-s3cret-s3cret-s3cret";
    expect(originSecretValid(new Headers({ [ORIGIN_HEADER]: secret }), secret)).toBe(true);
    expect(originSecretValid(new Headers({ [ORIGIN_HEADER]: `${secret}x` }), secret)).toBe(false);
    expect(originSecretValid(new Headers(), secret)).toBe(false);
  });
});
