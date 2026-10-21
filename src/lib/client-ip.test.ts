import { describe, expect, it } from "vitest";
import {
  applyClientIp,
  CLIENT_IP_HEADER,
  clientIp,
  ORIGIN_HEADER,
  originSecretValid,
  rateLimitBucket,
} from "./client-ip";

describe("applyClientIp()", () => {
  const forged = () =>
    new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "cf-ipcity": "Berlin",
      "x-forwarded-for": "198.51.100.2, 192.0.2.10",
      [CLIENT_IP_HEADER]: "10.0.0.1",
    });

  it("trusts Cloudflare only where every request must pass it", () => {
    const headers = forged();
    applyClientIp(headers, true);
    expect(clientIp(headers)).toBe("203.0.113.7");
    expect(headers.get("cf-ipcity")).toBe("Berlin");
  });

  it("otherwise takes the address the proxy in front appended and drops cf-* headers", () => {
    const headers = forged();
    applyClientIp(headers, false);
    expect(clientIp(headers)).toBe("192.0.2.10");
    expect(headers.get("cf-connecting-ip")).toBeNull();
    expect(headers.get("cf-ipcity")).toBeNull();
  });

  it("never passes on a client's own CLIENT_IP_HEADER", () => {
    const headers = new Headers({ [CLIENT_IP_HEADER]: "10.0.0.1" });
    applyClientIp(headers, false);
    expect(clientIp(headers)).toBeNull();
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
