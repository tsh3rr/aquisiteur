import "server-only";
import { getInfra } from "@/infra";

/**
 * The `sse` side of the RealtimePort. The token names and authorises the
 * topic, so the route needs no session: the cockpit and the exposé got it
 * from an authorised request.
 */
export async function liveStream(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  const { realtime } = getInfra();
  if (!token || token.length > 300 || !realtime.stream) {
    return new Response("Not found", { status: 404 });
  }
  const stream = await realtime.stream(token, request.signal);
  if (!stream) return new Response("Forbidden", { status: 403 });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
