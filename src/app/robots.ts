import type { MetadataRoute } from "next";
import { ROBOTS_RULES } from "@/lib/robots";

/** Same rules as the exposé hosts (src/lib/robots.ts); `noindex` keeps everything out of search. */
export default function robots(): MetadataRoute.Robots {
  return { rules: ROBOTS_RULES };
}
