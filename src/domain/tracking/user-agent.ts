/**
 * Coarse device facts from request headers (§6.2): device type, browser,
 * operating system. No fingerprinting: nothing beyond what the
 * User-Agent states, and nothing is stored per device.
 */
export type DeviceType = "mobile" | "tablet" | "desktop" | "unknown";

export interface DeviceInfo {
  device: DeviceType;
  browser: string | null;
  os: string | null;
}

const BROWSERS: [RegExp, string][] = [
  [/EdgA?\//, "Edge"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/CriOS\/|Chrome\//, "Chrome"],
  [/Version\/[\d.]+.*Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPod/, "iOS"],
  [/iPad/, "iPadOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function parseUserAgent(userAgent: string | null): DeviceInfo {
  const ua = userAgent ?? "";
  if (!ua) return { device: "unknown", browser: null, os: null };
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  const os = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  let device: DeviceType = "desktop";
  if (/iPad|Tablet|Android(?!.*Mobile)/.test(ua)) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android/.test(ua)) device = "mobile";
  return { device, browser, os };
}

/**
 * Link previews, mail scanners, crawlers and prefetches (§6.2). They are
 * recorded as bots so the owner can see them, but never count as a read.
 */
const BOT_PATTERNS: [RegExp, string][] = [
  [/WhatsApp/i, "WhatsApp-Vorschau"],
  [/facebookexternalhit|Facebot|meta-externalagent/i, "Facebook/Instagram-Vorschau"],
  [/TelegramBot/i, "Telegram-Vorschau"],
  [/Slackbot|Slack-ImgProxy/i, "Slack-Vorschau"],
  [/Discordbot/i, "Discord-Vorschau"],
  [/Twitterbot/i, "X/Twitter-Vorschau"],
  [/LinkedInBot/i, "LinkedIn-Vorschau"],
  [/SkypeUriPreview|MicrosoftPreview/i, "Microsoft-Vorschau"],
  [/BingPreview|Microsoft Office|MSOffice|ms-office|Outlook-iOS/i, "Outlook/Office-Prüfung"],
  [/Google-Safety|GoogleImageProxy|Google-Read-Aloud|Google-InspectionTool/i, "Google-Prüfung"],
  [
    /Proofpoint|Mimecast|Barracuda|Symantec|ZScaler|Trend ?Micro|Sophos|FireEye/i,
    "Mail-Sicherheitsscanner",
  ],
  [
    /Applebot|Googlebot|bingbot|YandexBot|DuckDuckBot|Baiduspider|Bytespider|GPTBot|ClaudeBot|CCBot|PerplexityBot/i,
    "Suchmaschinen-/KI-Crawler",
  ],
  [
    /HeadlessChrome|PhantomJS|Puppeteer|Playwright|Lighthouse|Chrome-Lighthouse/i,
    "Automatisierter Browser",
  ],
  [
    /curl|Wget|python-requests|python-urllib|aiohttp|Go-http-client|okhttp|Java\/|libwww|httpx|node-fetch|undici|axios/i,
    "Skript/HTTP-Client",
  ],
  [/bot\b|crawler|spider|preview|scanner|monitor|uptime/i, "Bot"],
];

export function detectBot(headers: Headers): string | null {
  const ua = headers.get("user-agent");
  if (!ua) return "Ohne User-Agent";
  for (const [pattern, reason] of BOT_PATTERNS) if (pattern.test(ua)) return reason;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""} ${headers.get("x-moz") ?? ""}`;
  if (/prefetch|prerender|preview/i.test(purpose)) return "Vorab-Laden (Prefetch)";
  return null;
}

/** Coarse location set by the edge (Cloudflare "visitor location headers"); the IP is never read. */
export function geoFromHeaders(headers: Headers): { city: string | null; country: string | null } {
  const city = headers.get("cf-ipcity") ?? headers.get("x-vercel-ip-city");
  const country = headers.get("cf-ipcountry") ?? headers.get("x-vercel-ip-country");
  return {
    city: city ? decodeURIComponent(city).slice(0, 80) : null,
    country: country && /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : null,
  };
}
