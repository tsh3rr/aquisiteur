import "server-only";
import { after } from "next/server";

/**
 * Work that must not hold up the response (score, notifications, pushes).
 * Inside a request it runs after the response is sent (`after`, which maps
 * to waitUntil on Workers); elsewhere (tests, scripts) it runs right away.
 */
export async function defer(task: () => Promise<unknown>): Promise<void> {
  const run = () =>
    task().then(
      () => undefined,
      (error: unknown) => console.error("deferred task failed", error),
    );
  try {
    after(run);
  } catch {
    await run();
  }
}
