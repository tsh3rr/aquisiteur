import { describe, expect, it } from "vitest";
import { detectBot, geoFromHeaders, parseUserAgent } from "./user-agent";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PIXEL =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const headers = (init: Record<string, string>) => new Headers(init);

describe("user agent", () => {
  it("recognises device, browser and system", () => {
    expect(parseUserAgent(IPHONE)).toEqual({ device: "mobile", browser: "Safari", os: "iOS" });
    expect(parseUserAgent(PIXEL)).toEqual({ device: "mobile", browser: "Chrome", os: "Android" });
    expect(parseUserAgent(MAC_CHROME)).toEqual({
      device: "desktop",
      browser: "Chrome",
      os: "macOS",
    });
    expect(parseUserAgent(IPAD).device).toBe("tablet");
    expect(parseUserAgent(null).device).toBe("unknown");
  });
});

describe("bot filter", () => {
  it("lets real browsers through", () => {
    for (const ua of [IPHONE, PIXEL, MAC_CHROME, IPAD]) {
      expect(detectBot(headers({ "user-agent": ua })), ua).toBeNull();
    }
  });

  it("flags link previews, scanners, crawlers and scripts", () => {
    const cases: Record<string, string> = {
      "WhatsApp/2.23.20.0 A": "WhatsApp-Vorschau",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)":
        "Facebook/Instagram-Vorschau",
      "TelegramBot (like TwitterBot)": "Telegram-Vorschau",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)": "Slack-Vorschau",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)":
        "Suchmaschinen-/KI-Crawler",
      "curl/8.5.0": "Skript/HTTP-Client",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36":
        "Automatisierter Browser",
    };
    for (const [ua, reason] of Object.entries(cases)) {
      expect(detectBot(headers({ "user-agent": ua })), ua).toBe(reason);
    }
    expect(detectBot(headers({}))).toBe("Ohne User-Agent");
  });

  it("flags prefetches of real browsers", () => {
    expect(detectBot(headers({ "user-agent": MAC_CHROME, "sec-purpose": "prefetch" }))).toBe(
      "Vorab-Laden (Prefetch)",
    );
  });

  it("reads the city from the edge, never the IP", () => {
    expect(
      geoFromHeaders(
        headers({ "cf-ipcity": "Leipzig", "cf-ipcountry": "DE", "x-real-ip": "1.2.3.4" }),
      ),
    ).toEqual({ city: "Leipzig", country: "DE" });
    expect(geoFromHeaders(headers({ "cf-ipcountry": "XX" }))).toEqual({
      city: null,
      country: null,
    });
  });
});
