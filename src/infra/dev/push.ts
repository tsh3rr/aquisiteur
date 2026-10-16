import { appendFileSync } from "node:fs";
import type { PushPort } from "../types";

/**
 * Development and tests: no push service. Every push is printed and, when
 * PUSH_LOG is set, appended as one JSON line (the E2E suite reads it).
 */
export function logPush(file?: string): PushPort {
  return {
    publicKey: null,
    async send(subscription, payload) {
      const line = JSON.stringify({ endpoint: subscription.endpoint, ...payload });
      console.info(`[push] ${line}`);
      if (file) appendFileSync(file, `${line}\n`);
      return { gone: false };
    },
  };
}
