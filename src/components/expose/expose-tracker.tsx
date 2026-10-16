"use client";

import { useEffect } from "react";
import { start } from "./tracking-client";

/** Mounts the tracking script on the public exposé only (§6.3). */
export function ExposeTracker({ slug }: { slug: string }) {
  useEffect(() => start(slug), [slug]);
  return null;
}
