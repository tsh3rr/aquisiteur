/**
 * The live feed on „Heute“ (§7.8): „Jetzt gerade: Café Müller liest die
 * Preise“. One short present-tense phrase per meaningful event.
 */
const SECTION_PHRASES: Record<string, string> = {
  hero: "öffnet das Exposé",
  personal_note: "liest Ihre persönliche Nachricht",
  audit: "sieht sich die Analyse an",
  before_after: "vergleicht Vorher und Nachher",
  findings: "liest die Befunde",
  proposal: "liest Ihre Vorschläge",
  mockup_gallery: "sieht sich die Entwürfe an",
  brand_preview: "sieht sich die Markenvorschau an",
  roadmap: "liest den Ablauf",
  pricing: "liest die Preise",
  testimonials: "liest Kundenstimmen",
  faq: "liest die häufigen Fragen",
  about: "liest über Sie",
  contact: "sieht sich den Kontaktbereich an",
};

const CHANNEL_PHRASES: Record<string, string> = {
  whatsapp: "klickt auf WhatsApp",
  phone: "klickt auf Anrufen",
  email: "klickt auf E-Mail",
  booking: "öffnet die Terminbuchung",
  messenger: "klickt auf Messenger",
  sms: "klickt auf SMS",
};

export function activityPhrase(event: {
  type: string;
  payload: Record<string, unknown>;
}): string | null {
  switch (event.type) {
    case "page_view":
      return "öffnet das Exposé";
    case "section_view":
      return SECTION_PHRASES[String(event.payload.blockType)] ?? null;
    case "contact_click":
      return CHANNEL_PHRASES[String(event.payload.channel)] ?? null;
    case "pricing_change":
      return "stellt sich ein Angebot zusammen";
    case "chat_open":
      return "öffnet den Chat";
    case "callback_started":
      return "füllt das Rückrufformular aus";
    case "copy_contact":
      return "kopiert Ihre Kontaktdaten";
    default:
      return null;
  }
}
