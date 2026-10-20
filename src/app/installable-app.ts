import type { Metadata } from "next";

/**
 * Metadata for the installable cockpit app. Only the cockpit, auth and
 * onboarding layouts use it; workspace hosts (exposés) must not link the
 * manifest or the Aquisiteur home-screen icon.
 */
export const installableAppMetadata: Metadata = {
  manifest: "/manifest.webmanifest",
  icons: { apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" } },
  appleWebApp: { capable: true, title: "Aquisiteur", statusBarStyle: "default" },
};
