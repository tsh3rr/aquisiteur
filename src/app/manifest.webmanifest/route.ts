import type { MetadataRoute } from "next";

/**
 * Cockpit web app manifest. A route handler instead of app/manifest.ts,
 * because the file convention links it from every page, including exposés
 * on workspace hosts (where it does not exist). The cockpit layouts link it
 * via their metadata.
 */
export const dynamic = "force-static";

const manifest: MetadataRoute.Manifest = {
  name: "Aquisiteur Cockpit",
  short_name: "Aquisiteur",
  start_url: "/",
  display: "standalone",
  lang: "de",
  background_color: "#fbfbfe",
  theme_color: "#4f3bd9",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    {
      src: "/icons/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
  ],
};

export function GET() {
  return Response.json(manifest, {
    headers: { "content-type": "application/manifest+json" },
  });
}
