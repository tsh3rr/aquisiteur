import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { hstsHeader, staticSecurityHeaders } from "./src/lib/security-headers";

const isHttps = (process.env.APP_URL ?? "").startsWith("https:");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    // Profile photo and logo arrive as already scaled renditions (brand-image-actions.ts).
    serverActions: { bodySizeLimit: "8mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...staticSecurityHeaders, ...(isHttps ? [hstsHeader] : [])],
      },
      {
        // The exposé preview is framed by the cockpit (CSP frame-ancestors 'self').
        source: "/preview/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;

if (process.env.HOSTING_PROFILE === "cloudflare" && process.env.NODE_ENV === "development") {
  // Exposes Cloudflare bindings (Hyperdrive, R2 …) to `next dev` via wrangler's local proxy.
  void initOpenNextCloudflareForDev();
}
