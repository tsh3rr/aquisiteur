import type { MetadataRoute } from "next";

/** The cockpit is private; nothing here is meant for search engines. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
