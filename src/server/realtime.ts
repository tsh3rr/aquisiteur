import "server-only";
import { getInfra } from "@/infra";
import type { RealtimeEvent } from "@/domain/realtime";

/**
 * Topics of the RealtimePort (§6.4). The cockpit listens on its workspace,
 * a visitor only on their own chat thread. Publishing is best effort: a
 * failed broadcast never fails the request that stored the data; clients
 * refetch whenever they (re)connect.
 */
export const workspaceTopic = (workspaceId: string) => `ws-${workspaceId}`;
export const threadTopic = (threadId: string) => `chat-${threadId}`;

export async function publish<E extends RealtimeEvent>(
  topics: string[],
  event: E["event"],
  payload: E["payload"],
): Promise<void> {
  await Promise.all(
    topics.map((topic) =>
      getInfra()
        .realtime.publish(topic, event, payload)
        .catch((error: unknown) => console.error("realtime publish failed", error)),
    ),
  );
}

export function liveSubscription(topic: string) {
  return getInfra().realtime.subscription(topic);
}
