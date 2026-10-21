import type { Database } from "@/db";
import { CONSENT_NOTICE_VERSION } from "@/domain/tracking/consent";
import { recordConsent } from "@/server/tracking/replay";

/** The visitor clicks „Akzeptieren“: reading statistics for this visit (ADR-0065). */
export async function allowStatistics(db: Database, workspaceId: string, token: string) {
  const result = await recordConsent(db, {
    workspaceId,
    body: { token, scope: "statistics", decision: "given", version: CONSENT_NOTICE_VERSION },
  });
  if (result !== "ok") throw new Error(`consent failed: ${result}`);
}
