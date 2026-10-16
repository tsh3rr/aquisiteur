import { liveStream } from "@/server/live";

export const dynamic = "force-dynamic";

/** Server-Sent Events for the visitor's chat thread (in-process realtime only). */
export async function GET(request: Request) {
  return liveStream(request);
}
