import type { ProspectStatus } from "../prospects/status";

/**
 * The campaign funnel (§7.8): versendet → geöffnet → gelesen →
 * Kontaktversuch → Kontakt → Termin → gewonnen. A prospect counts for every
 * stage it ever reached, also when it was lost later.
 */
export const FUNNEL_STAGES = [
  "sent",
  "opened",
  "read",
  "attempt",
  "contact",
  "meeting",
  "won",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_LABELS: Record<FunnelStage, string> = {
  sent: "Versendet",
  opened: "Geöffnet",
  read: "Gelesen",
  attempt: "Kontaktversuch",
  contact: "Kontakt",
  meeting: "Termin",
  won: "Gewonnen",
};

export interface FunnelProspect {
  opened: boolean;
  read: boolean;
  attempt: boolean;
  /** Current status plus every status it was ever set to. */
  statuses: ProspectStatus[];
}

const STATUS_STAGE: Partial<Record<ProspectStatus, FunnelStage>> = {
  opened: "opened",
  interested: "read",
  contacted: "contact",
  meeting: "meeting",
  won: "won",
};

/** The furthest stage a prospect reached; later stages imply earlier ones. */
export function reachedStage(prospect: FunnelProspect): FunnelStage {
  let index = 0;
  const reach = (stage: FunnelStage) => {
    index = Math.max(index, FUNNEL_STAGES.indexOf(stage));
  };
  if (prospect.opened) reach("opened");
  if (prospect.read) reach("read");
  if (prospect.attempt) reach("attempt");
  for (const status of prospect.statuses) {
    const stage = STATUS_STAGE[status];
    if (stage) reach(stage);
  }
  return FUNNEL_STAGES[index]!;
}

export interface FunnelRow {
  stage: FunnelStage;
  label: string;
  count: number;
  /** Share of "sent". */
  rate: number | null;
  /** Share lost since the previous stage. */
  dropOff: number | null;
}

export function buildFunnel(prospects: FunnelProspect[]): FunnelRow[] {
  const counts = new Map<FunnelStage, number>(FUNNEL_STAGES.map((stage) => [stage, 0]));
  for (const prospect of prospects) {
    const furthest = FUNNEL_STAGES.indexOf(reachedStage(prospect));
    for (let i = 0; i <= furthest; i++) {
      counts.set(FUNNEL_STAGES[i]!, counts.get(FUNNEL_STAGES[i]!)! + 1);
    }
  }
  const sent = counts.get("sent")!;
  return FUNNEL_STAGES.map((stage, index) => {
    const count = counts.get(stage)!;
    const before = index === 0 ? null : counts.get(FUNNEL_STAGES[index - 1]!)!;
    return {
      stage,
      label: FUNNEL_LABELS[stage],
      count,
      rate: sent > 0 ? count / sent : null,
      dropOff: before === null || before === 0 ? null : (before - count) / before,
    };
  });
}
