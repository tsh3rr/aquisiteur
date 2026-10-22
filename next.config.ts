import path from "node:path";
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
  webpack(config, { isServer }) {
    if (isServer) {
      // Browser-only libraries, loaded on demand in the browser (letter PDF, map,
      // session replay). Kept out of the server bundle so the Worker stays within
      // the free plan's size limit (ADR-0035, ADR-0037).
      config.resolve ??= {};
      config.resolve.alias = {
        ...config.resolve.alias,
        "@react-pdf/renderer$": false,
        // Next treats react-pdf as an external server package, which an alias cannot
        // replace; dropping the one module that imports it keeps it out instead.
        [path.join(process.cwd(), "src/components/letters/letter-document.tsx")]: false,
        [path.join(process.cwd(), "src/components/expose-pdf/expose-document.tsx")]: false,
        // Exposé layers that only an effect in the browser imports (ADR-0065):
        // the consent notice and the contact layer with its chat panel.
        [path.join(process.cwd(), "src/components/expose/consent-notice.tsx")]: false,
        [path.join(process.cwd(), "src/components/expose/contact-layer.tsx")]: false,
        // The offer editor, loaded on mount in the cockpit (ADR-0067).
        [path.join(process.cwd(), "src/app/(cockpit)/angebote/[id]/offer-editor.tsx")]: false,
        leaflet$: false,
        rrweb$: false,
      };
    }
    return config;
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
  // Imported lazily: it is a dev dependency, and the app image ships without those (Dockerfile).
  void import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}
