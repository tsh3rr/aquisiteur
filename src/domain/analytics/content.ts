/** Labels for the content dashboard (§7.8 „Inhalts-Dashboard“). */

export const BLOCK_TYPE_LABELS: Record<string, string> = {
  hero: "Einstieg",
  personal_note: "Persönliche Nachricht",
  audit: "Analyse",
  before_after: "Vorher/Nachher",
  findings: "Befunde",
  proposal: "Vorschlag",
  mockup_gallery: "Entwürfe",
  brand_preview: "Markenauftritt",
  roadmap: "Ablauf",
  pricing: "Preise",
  testimonials: "Referenzen",
  faq: "Häufige Fragen",
  about: "Über mich",
  contact: "Kontakt",
  cta: "Handlungsaufruf",
};

export const CHANNEL_LABELS: Record<string, string> = {
  chat: "Live-Chat",
  whatsapp: "WhatsApp",
  phone: "Anruf",
  email: "E-Mail",
  booking: "Termin buchen",
  messenger: "Messenger",
  sms: "SMS",
  callback: "Rückrufwunsch",
};

export const NUDGE_LABELS: Record<string, string> = {
  read_invite: "Einladung beim Lesen",
  pricing: "Hinweis bei den Preisen",
  returning: "Wiederkehrender Besuch",
  exit_intent: "Beim Verlassen",
};

export const blockLabel = (type: string) => BLOCK_TYPE_LABELS[type] ?? type;
