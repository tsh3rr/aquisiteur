import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Phase 0: no incremental cache override. Exposé pages (phase 1) will add the
// R2 incremental cache once static exposé rendering lands.
export default defineCloudflareConfig({});
