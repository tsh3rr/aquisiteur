import { liveStream } from "@/server/live";

export const dynamic = "force-dynamic";

/** Server-Sent Events for the cockpit (in-process realtime only). */
export async function GET(request: Request) {
  return liveStream(request);
}
