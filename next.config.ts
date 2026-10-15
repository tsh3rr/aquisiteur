import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { hstsHeader, staticSecurityHeaders } from "./src/lib/security-headers";

const isHttps = (process.env.APP_URL ?? "").startsWith("https:");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...staticSecurityHeaders, ...(isHttps ? [hstsHeader] : [])],
      },
    ];
  },
};

export default nextConfig;

if (process.env.HOSTING_PROFILE === "cloudflare" && process.env.NODE_ENV === "development") {
  // Exposes Cloudflare bindings (Hyperdrive, R2 …) to `next dev` via wrangler's local proxy.
  void initOpenNextCloudflareForDev();
}
