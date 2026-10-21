/**
 * Two-tier measurement on the exposé (§9, ADR-0065). Without consent only
 * the basis runs: what the server sees anyway when the page is requested,
 * plus what the visitor sends on purpose. Reading statistics and the
 * recording need a „yes“ each; both start unticked. Kept free of zod so the
 * tracking script can import it (< 5 KB gzip).
 */

export const CONSENT_PURPOSES = ["statistics", "replay"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Version of the notice wording; stored with every decision as proof. */
export const CONSENT_NOTICE_VERSION = "2026-10-21";

/** The device asks again after this long, even if the wording did not change. */
export const CONSENT_MAX_AGE_DAYS = 180;

export const CONSENT_NOTICE = {
  title: "Darf ich sehen, was Sie interessiert?",
  body: (company: string) =>
    `Diese Seite habe ich persönlich für ${company} erstellt. Ohne Ihre Zustimmung sehe ich nur, dass sie geöffnet wurde, und was Sie mir selbst schicken. Mit Ihrer Zustimmung sehe ich zusätzlich, welche Abschnitte Sie wie lange lesen, damit ich mich mit dem melde, was Sie wirklich interessiert.`,
  reject: "Ablehnen",
  choose: "Auswählen",
  accept: "Einverstanden",
  save: "Auswahl speichern",
  acceptAll: "Alle erlauben",
  close: "Hinweis schließen",
  necessary: {
    label: "Notwendig",
    text: "Anzeige der Seite, Chat und Rückruf, wenn Sie sie nutzen, Schutz vor Missbrauch und Ihre Entscheidung. Dazu sehe ich, dass und wann die Seite geöffnet wurde.",
  },
  statistics: {
    label: "Lesestatistik",
    text: "Welche Abschnitte Sie lesen, wie lange und wie weit Sie scrollen, welche Kontaktwege und Preisoptionen Sie ansteuern, ob Sie im Chat angefangen haben zu schreiben (nie was), und dass Sie gerade auf der Seite sind.",
  },
  replay: {
    label: "Aufzeichnung",
    text: (days: number) =>
      `Eine Aufzeichnung, wie Sie scrollen und klicken, ohne Eingaben und ohne Chat. Gelöscht nach ${days} Tagen oder sofort, wenn Sie widerrufen.`,
  },
  settings: "Datenschutz-Einstellungen",
} as const;

/**
 * Events the script may send without consent: the page was opened, the
 * visitor asked for a share link, or objected. Everything else it observes
 * is reading statistics. Server-written events (chat, callback, consent)
 * never come from the script.
 */
export const BASIS_EVENT_TYPES: ReadonlySet<string> = new Set(["page_view", "share", "opt_out"]);

export function isStatisticsEvent(type: string): boolean {
  return !BASIS_EVENT_TYPES.has(type);
}

/** Remembered on the device: the decisions only, never an identifier. */
export const CONSENT_STORAGE_KEY = "aq-consent";
/** Phase 5 key, replay only; removed when the new notice is answered. */
export const LEGACY_CONSENT_STORAGE_KEY = "aq-replay-consent";

export interface StoredConsent {
  statistics: boolean;
  replay: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function serializeConsent(choice: StoredConsent, now = Date.now()): string {
  return JSON.stringify({
    v: CONSENT_NOTICE_VERSION,
    t: Math.floor(now / DAY_MS),
    s: choice.statistics,
    r: choice.replay,
  });
}

/** What the device remembers, read defensively: other versions and old answers ask again. */
export function storedConsent(raw: string | null, now = Date.now()): StoredConsent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { v?: unknown; t?: unknown; s?: unknown; r?: unknown };
    if (value.v !== CONSENT_NOTICE_VERSION) return null;
    if (typeof value.t !== "number" || Math.floor(now / DAY_MS) - value.t > CONSENT_MAX_AGE_DAYS) {
      return null;
    }
    if (typeof value.s !== "boolean" || typeof value.r !== "boolean") return null;
    return { statistics: value.s, replay: value.r };
  } catch {
    return null;
  }
}
