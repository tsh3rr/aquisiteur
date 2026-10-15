import type { ExposeOutline } from "../expose/outline";
import { isProspectStatus, STATUS_LABELS } from "../prospects/status";

/**
 * Turns visits, events and audit entries into the readable customer
 * timeline (§7.8): „Per QR-Code geöffnet“, „Preise 35 s gelesen“ … Pure, so
 * the wording is unit-tested; the server only loads the rows.
 */

export interface TimelineVisit {
  id: string;
  source: "qr" | "typed" | "direct" | "share";
  device: "mobile" | "tablet" | "desktop" | "unknown";
  browser: string | null;
  os: string | null;
  city: string | null;
  isBot: boolean;
  botReason: string | null;
  isInternal: boolean;
  confirmedAt: Date | null;
  startedAt: Date;
  activeSeconds: number;
  maxScroll: number;
  touchpointLabel: string | null;
}

export interface TimelineEvent {
  visitId: string;
  type: string;
  blockId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface TimelineAudit {
  action: string;
  meta: Record<string, unknown>;
  createdAt: Date;
  actorName: string | null;
}

export type TimelineKind = "visit" | "status" | "expose" | "touchpoint";

export interface TimelineEntry {
  key: string;
  kind: TimelineKind;
  at: Date;
  title: string;
  detail: string | null;
  /** What happened during a visit, oldest first. */
  steps: { at: Date; text: string }[];
  /** Bots, owner visits and visits whose page never loaded. */
  muted: boolean;
  bot: boolean;
}

const DEVICE_LABELS = {
  mobile: "Smartphone",
  tablet: "Tablet",
  desktop: "Computer",
  unknown: "Unbekanntes Gerät",
} as const;

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  phone: "Anrufen",
  email: "E-Mail",
};

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function visitTitle(visit: TimelineVisit): string {
  if (visit.isBot) return `Link-Vorschau oder Bot (${visit.botReason ?? "erkannt"})`;
  const how = {
    qr: "Per QR-Code geöffnet",
    typed: "Kurzlink abgetippt",
    direct: "Exposé direkt geöffnet",
    share: "Weitergeleiteten Link geöffnet",
  }[visit.source];
  if (visit.isInternal) return `${how} (Ihr eigenes Gerät)`;
  if (!visit.confirmedAt) return `${how.replace("geöffnet", "aufgerufen")}, Seite nicht geladen`;
  return how;
}

export function visitDetail(visit: TimelineVisit): string {
  const device = [DEVICE_LABELS[visit.device], visit.os, visit.browser].filter(Boolean).join(", ");
  const parts = [device, visit.city];
  if (visit.confirmedAt && !visit.isBot) {
    if (visit.activeSeconds > 0) parts.push(`${formatDuration(visit.activeSeconds)} aktiv`);
    if (visit.maxScroll > 0) parts.push(`${visit.maxScroll} % gescrollt`);
  }
  if (visit.touchpointLabel) parts.push(`über „${visit.touchpointLabel}“`);
  return parts.filter(Boolean).join(" · ");
}

function blockName(outline: ExposeOutline, blockId: string | null): string {
  return (blockId && outline.blocks.get(blockId)) || "einen Abschnitt";
}

/** One readable line per event, or null for events the timeline leaves out. */
export function describeEvent(event: TimelineEvent, outline: ExposeOutline): string | null {
  const payload = event.payload;
  switch (event.type) {
    case "section_dwell":
      return `„${blockName(outline, event.blockId)}“ ${formatDuration(Number(payload.seconds ?? 0))} gelesen`;
    case "contact_click":
      return `Kontakt per ${CHANNEL_LABELS[String(payload.channel)] ?? "Kontaktlink"} angeklickt`;
    case "copy_contact":
      return `${payload.channel === "email" ? "E-Mail-Adresse" : "Telefonnummer"} kopiert`;
    case "cta_click":
      return `${blockName(outline, event.blockId)} geklickt`;
    case "pricing_change": {
      const option =
        outline.pricingOptions.get(`${event.blockId}:${String(payload.optionId)}`) ??
        String(payload.optionId);
      return `Preisoption „${option}“ ${payload.selected ? "gewählt" : "abgewählt"}`;
    }
    case "media_play":
      return "Video abgespielt";
    case "share":
      return "„Mit Kollegen teilen“ genutzt";
    case "pdf_download":
      return "Als PDF gespeichert oder gedruckt";
    case "opt_out":
      return "„Kein Interesse“ angeklickt";
    default:
      // page_view, section_view, scroll_depth and heartbeats feed the visit summary.
      return null;
  }
}

function auditEntry(audit: TimelineAudit, index: number): TimelineEntry | null {
  const base = { key: `audit-${index}`, at: audit.createdAt, steps: [], muted: false, bot: false };
  switch (audit.action) {
    case "prospect.status_changed": {
      const to = audit.meta.to;
      const label = isProspectStatus(to) ? STATUS_LABELS[to] : String(to);
      const by =
        audit.meta.via === "visit"
          ? "automatisch beim ersten Besuch"
          : audit.actorName
            ? `von ${audit.actorName}`
            : null;
      return { ...base, kind: "status", title: `Status: ${label}`, detail: by };
    }
    case "prospect.opted_out":
      return {
        ...base,
        kind: "status",
        title: "Kein Interesse gemeldet",
        detail: "Über den Link im Exposé. Erinnerungen sind gesperrt.",
      };
    case "expose.published":
      return {
        ...base,
        kind: "expose",
        title: audit.meta.version
          ? `Exposé Version ${String(audit.meta.version)} veröffentlicht`
          : "Exposé veröffentlicht",
        detail: audit.actorName ? `von ${audit.actorName}` : null,
      };
    case "touchpoint.created":
      return {
        ...base,
        kind: "touchpoint",
        title: `Link „${String(audit.meta.label ?? "")}“ angelegt`,
        detail: audit.actorName ? `von ${audit.actorName}` : null,
      };
    default:
      return null;
  }
}

export function buildTimeline(input: {
  visits: TimelineVisit[];
  events: TimelineEvent[];
  audits: TimelineAudit[];
  outline: ExposeOutline;
  showBots: boolean;
}): TimelineEntry[] {
  const steps = new Map<string, { at: Date; text: string }[]>();
  for (const event of [...input.events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  )) {
    const text = describeEvent(event, input.outline);
    if (!text) continue;
    const list = steps.get(event.visitId) ?? [];
    list.push({ at: event.occurredAt, text });
    steps.set(event.visitId, list);
  }

  const entries: TimelineEntry[] = input.visits
    .filter((visit) => input.showBots || !visit.isBot)
    .map((visit) => ({
      key: `visit-${visit.id}`,
      kind: "visit" as const,
      at: visit.startedAt,
      title: visitTitle(visit),
      detail: visitDetail(visit) || null,
      steps: steps.get(visit.id) ?? [],
      muted: visit.isBot || visit.isInternal || !visit.confirmedAt,
      bot: visit.isBot,
    }));
  input.audits.forEach((audit, index) => {
    const entry = auditEntry(audit, index);
    if (entry) entries.push(entry);
  });
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}
