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
  booking: "Terminbuchung",
  messenger: "Messenger",
  sms: "SMS",
};

const NUDGE_LABELS: Record<string, string> = {
  read_invite: "Einladung nach dem Lesen",
  pricing: "Angebot zur Preisauswahl",
  returning: "Begrüßung beim erneuten Besuch",
  exit_intent: "Hinweis beim Verlassen",
};

const CHAT_OPENED_FROM: Record<string, string> = {
  launcher: "über den Chat-Knopf",
  contact: "im Kontaktbereich",
  nudge: "über einen Hinweis",
  bar: "über die Kontaktleiste",
};

/** Typed in the chat during a visit (§7.5 „Entwurfserkennung“). */
export interface TimelineDraft {
  visitId: string;
  /** Current, unsent length; 0 once sent or deleted. */
  length: number;
  maxLength: number;
  /** Whether the visit has a chat thread (something was sent). */
  sent: boolean;
  content: string | null;
  updatedAt: Date;
}

export function describeDraft(draft: TimelineDraft): string | null {
  if (draft.length > 0) {
    const text = `${draft.length} Zeichen in den Chat getippt, aber nicht gesendet`;
    return draft.content ? `${text}: „${draft.content}“` : text;
  }
  if (!draft.sent && draft.maxLength > 0) {
    return `Chat-Nachricht mit ${draft.maxLength} Zeichen angefangen und wieder gelöscht`;
  }
  return null;
}

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
    case "chat_open":
      return `Chat geöffnet ${CHAT_OPENED_FROM[String(payload.source)] ?? ""}`.trim();
    case "chat_message_sent":
      return `Chat-Nachricht gesendet (${Number(payload.length ?? 0)} Zeichen)`;
    case "callback_started":
      return "Rückrufformular geöffnet";
    case "callback_submitted":
      return "Rückruf angefordert";
    case "nudge_shown":
      return `Hinweis gezeigt: ${NUDGE_LABELS[String(payload.nudge)] ?? "Hinweis"}`;
    case "nudge_clicked":
      return `Hinweis angeklickt: ${NUDGE_LABELS[String(payload.nudge)] ?? "Hinweis"}`;
    case "nudge_dismissed":
      return `Hinweis geschlossen: ${NUDGE_LABELS[String(payload.nudge)] ?? "Hinweis"}`;
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
          : audit.meta.via === "chat"
            ? "automatisch durch eine Chat-Nachricht"
            : audit.meta.via === "callback"
              ? "automatisch durch einen Rückrufwunsch"
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
  drafts?: TimelineDraft[];
  outline: ExposeOutline;
  showBots: boolean;
}): TimelineEntry[] {
  const steps = new Map<string, { at: Date; text: string }[]>();
  const add = (visitId: string, at: Date, text: string) => {
    const list = steps.get(visitId) ?? [];
    list.push({ at, text });
    steps.set(visitId, list);
  };
  for (const event of input.events) {
    const text = describeEvent(event, input.outline);
    if (text) add(event.visitId, event.occurredAt, text);
  }
  for (const draft of input.drafts ?? []) {
    const text = describeDraft(draft);
    if (text) add(draft.visitId, draft.updatedAt, text);
  }
  for (const list of steps.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());

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
