import type { ExposeOutline } from "../expose/outline";

export interface SectionHeat {
  blockId: string;
  name: string;
  /** Visible seconds over all real visits. */
  seconds: number;
  /** Real visits that read the section (≥ 3 s). */
  visits: number;
}

/**
 * Section heatmap of one exposé (§7.8 „Abschnitts-Heatmap auf dem Exposé“):
 * reading time per section, in the exposé's order, real visits only.
 */
export function sectionHeat(
  outline: ExposeOutline,
  events: {
    visitId: string;
    type: string;
    blockId: string | null;
    payload: Record<string, unknown>;
  }[],
  realVisitIds: Set<string>,
): SectionHeat[] {
  const seconds = new Map<string, number>();
  const readers = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.type !== "section_dwell" || !event.blockId || !realVisitIds.has(event.visitId)) {
      continue;
    }
    seconds.set(
      event.blockId,
      (seconds.get(event.blockId) ?? 0) + Number(event.payload.seconds ?? 0),
    );
    const set = readers.get(event.blockId) ?? new Set();
    set.add(event.visitId);
    readers.set(event.blockId, set);
  }
  return [...outline.blocks].map(([blockId, name]) => ({
    blockId,
    name,
    seconds: seconds.get(blockId) ?? 0,
    visits: readers.get(blockId)?.size ?? 0,
  }));
}
