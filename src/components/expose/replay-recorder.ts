/**
 * Session replay recorder, loaded only after the visitor said yes (§9).
 * rrweb masks every input; chat and callback forms are blocked entirely.
 * Uploads in chunks to /t/replay; stops for good when the server says no.
 */
import { REPLAY_LIMITS } from "@/domain/tracking/replay";

type Stop = () => void;

export async function startRecording(token: string): Promise<Stop> {
  const { record } = await import("rrweb");
  let buffer: unknown[] = [];
  let bytes = 0;
  let stopped = false;

  const flush = (leaving = false) => {
    if (stopped && !leaving) return;
    if (buffer.length === 0) return;
    const body = JSON.stringify({ token, events: buffer });
    buffer = [];
    bytes = 0;
    void fetch("/t/replay", {
      method: "POST",
      body,
      // keepalive allows at most 64 KB; larger chunks risk being cut off on exit.
      keepalive: leaving && body.length < 60_000,
      headers: { "content-type": "application/json" },
    })
      .then((response) => {
        if (response.status === 403 || response.status === 413) stop();
      })
      .catch(() => undefined);
  };

  const stopRecord = record({
    emit(event) {
      if (stopped) return;
      buffer.push(event);
      bytes += JSON.stringify(event).length;
      if (bytes > REPLAY_LIMITS.chunkBytes * 0.7 || buffer.length >= 1500) flush();
    },
    maskAllInputs: true,
    blockSelector: "[data-replay-block]",
    sampling: { mousemove: 100, scroll: 150, input: "last" },
    recordCanvas: false,
    collectFonts: false,
  });
  const timer = window.setInterval(() => flush(), REPLAY_LIMITS.flushMs);
  const onHide = () => {
    if (document.visibilityState === "hidden") flush(true);
  };
  document.addEventListener("visibilitychange", onHide);

  function stop() {
    if (stopped) return;
    stopped = true;
    stopRecord?.();
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onHide);
    buffer = [];
  }
  return stop;
}
