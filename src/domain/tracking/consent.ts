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
  title: "Datenschutzhinweis",
  body: (company: string) =>
    `Diese Seite wurde für ${company} erstellt. Ohne Ihre Einwilligung erfassen wir nur den Aufruf der Seite und die Angaben, die Sie uns selbst übermitteln. Mit Ihrer Einwilligung erfassen wir zusätzlich, welche Abschnitte Sie wie lange lesen (Lesestatistik), um unsere Kontaktaufnahme auf Ihr Interesse abzustimmen. Die Einwilligung ist freiwillig und jederzeit widerruflich.`,
  reject: "Ablehnen",
  choose: "Einstellungen",
  accept: "Akzeptieren",
  save: "Auswahl speichern",
  acceptAll: "Alle akzeptieren",
  close: "Hinweis schließen",
  necessary: {
    label: "Technisch erforderlich",
    text: "Bereitstellung der Seite, Chat und Rückruf bei Nutzung, Schutz vor Missbrauch und Speicherung Ihrer Auswahl. Dabei wird erfasst, dass und wann die Seite aufgerufen wurde. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.",
  },
  statistics: {
    label: "Lesestatistik",
    text: "Erfassung der angesehenen Abschnitte und ihrer Lesedauer, der Scrolltiefe, der Nutzung von Kontaktwegen und Preisoptionen, des Beginns einer Chat-Eingabe (ohne deren Inhalt) sowie Ihrer Anwesenheit auf der Seite. Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).",
  },
  replay: {
    label: "Sitzungsaufzeichnung",
    text: (days: number) =>
      `Aufzeichnung von Scrollen, Klicks und Mausbewegungen auf dieser Seite, ohne Eingaben in Formularfeldern und ohne Chat. Löschung nach ${days} Tagen oder unverzüglich nach Widerruf. Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).`,
  },
  settings: "Datenschutz-Einstellungen",
  more: "Datenschutzerklärung",
  revoke:
    "Sie können Ihre Auswahl jederzeit über „Datenschutz-Einstellungen“ am Seitenende ändern oder widerrufen. Weitere Informationen enthält unsere",
  recording: "Sitzungsaufzeichnung aktiv · widerrufen",
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
