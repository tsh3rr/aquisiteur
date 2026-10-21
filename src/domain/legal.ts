import { DEFAULT_DATA_SOURCE } from "./letters/compose";
import type { WorkspaceSettings } from "./workspace-settings";

/**
 * Fallback texts for the public legal pages of a workspace (§9). Each
 * workspace can replace them in its settings (legal.*Markdown). Not legal
 * advice: docs/PRIVACY.md asks for a review before going live.
 */
export function imprintMarkdown(settings: WorkspaceSettings, workspaceName: string): string {
  if (settings.legal.imprintMarkdown) return settings.legal.imprintMarkdown;
  const address = settings.senderAddress;
  const lines = [
    `**${address.company ?? workspaceName}**`,
    settings.profile.displayName,
    address.street,
    [address.postalCode, address.city].filter(Boolean).join(" "),
  ].filter(Boolean);
  const contact = [
    settings.channels.email ? `E-Mail: ${settings.channels.email}` : null,
    settings.channels.phone ? `Telefon: ${settings.channels.phone}` : null,
  ].filter(Boolean);
  return [lines.join("\n"), contact.join("\n")].filter(Boolean).join("\n\n");
}

/** Who hosts the installation; named in the generated privacy text. */
export type HostingProfile = "node" | "cloudflare";

const PROCESSOR_LIST: Record<HostingProfile, string> = {
  node: "Mikrus (Server und Datenbank, Finnland), Cloudflare (Auslieferung und Schutz der Seite; Dateien und Sicherungen in der EU), Resend (E-Mail-Benachrichtigungen an uns, Irland), Sentry (Fehlerberichte ohne personenbezogene Daten, Frankfurt)",
  cloudflare:
    "Cloudflare (Hosting, Auslieferung und Schutz der Seite), Supabase (Datenbank, Frankfurt), Resend (E-Mail-Benachrichtigungen an uns, Irland), Sentry (Fehlerberichte ohne personenbezogene Daten, Frankfurt)",
};

/** The device rule of the sender's country (§ 25 TDDDG in Germany, § 165 TKG 2021 in Austria). */
function deviceRule(country: string): string {
  if (country === "AT") return "§ 165 Abs. 3 TKG 2021";
  if (country === "DE") return "§ 25 Abs. 1 TDDDG";
  return "§ 25 Abs. 1 TDDDG bzw. § 165 Abs. 3 TKG 2021";
}

function deviceException(country: string): string {
  if (country === "AT") return "§ 165 Abs. 3 TKG 2021";
  if (country === "DE") return "§ 25 Abs. 2 Nr. 2 TDDDG";
  return "§ 25 Abs. 2 Nr. 2 TDDDG bzw. § 165 Abs. 3 TKG 2021";
}

function authority(country: string): string {
  if (country === "AT") {
    return "Für uns zuständig ist die österreichische Datenschutzbehörde, Barichgasse 40–42, 1030 Wien.";
  }
  if (country === "DE") {
    return "Für uns zuständig ist die Datenschutzaufsichtsbehörde des Bundeslandes, in dem wir unseren Sitz haben.";
  }
  return "";
}

interface Heading {
  title: string;
}
/** Section headings are numbered when joined, so a missing section leaves no gap. */
const heading = (title: string): Heading => ({ title });

/**
 * The exposé's privacy policy (§9, ADR-0065): basis without consent,
 * reading statistics and recording only with it, the letter's data source,
 * storage on the device, retention and the right to object.
 */
export function privacyMarkdown(
  settings: WorkspaceSettings,
  workspaceName: string,
  hosting: HostingProfile = "node",
): string {
  if (settings.legal.privacyMarkdown) return settings.legal.privacyMarkdown;
  const address = settings.senderAddress;
  const controller = address.company ?? workspaceName;
  const country = address.country;
  const rule = deviceRule(country);
  const email = settings.channels.email;
  const reach = [
    email ? `E-Mail: ${email}` : null,
    settings.channels.phone ? `Telefon: ${settings.channels.phone}` : null,
  ].filter(Boolean);
  const place = [address.postalCode, address.city].filter(Boolean).join(" ");
  const ask = email ? `Eine Nachricht an ${email} genügt.` : "Eine formlose Nachricht genügt.";
  const { eventsDays, replaysDays, optOutTrackingDays } = settings.retention;
  let number = 0;
  return [
    heading("Wer verantwortlich ist"),
    [
      [controller, settings.profile.displayName, address.street, place].filter(Boolean).join(", ") +
        " (siehe Impressum).",
      reach.join(", "),
    ]
      .filter(Boolean)
      .join(" "),
    heading("Worum es geht"),
    "Sie haben von uns per Post persönliche Vorschläge für Ihr Unternehmen erhalten. Diese Seite zeigt sie Ihnen. Der QR-Code und der Kurzlink im Brief sind nur für Ihr Unternehmen erstellt; deshalb können wir Besuche dieser Seite Ihrem Unternehmen zuordnen. Hier steht, was wir dabei erfahren, was nur mit Ihrer Zustimmung, und wie Sie widersprechen.",
    heading("Woher wir Ihre Daten haben"),
    `Firmenname, Anschrift und gegebenenfalls den Namen der Ansprechperson haben wir aus ${settings.legal.dataSource ?? DEFAULT_DATA_SOURCE}. Wir nutzen sie, um Ihnen ein Angebot für unsere Leistungen zu schicken. Rechtsgrundlage ist unser berechtigtes Interesse an der Werbung für unsere Leistungen (Art. 6 Abs. 1 lit. f DSGVO).`,
    heading("Aufruf der Seite"),
    "Beim Aufruf verarbeitet unser Hosting technisch notwendige Daten wie IP-Adresse, Zeitpunkt, aufgerufene Adresse und Browserkennung, um die Seite auszuliefern. Die IP-Adresse speichern wir nicht. Zum Schutz vor dem Durchprobieren von Kurzlinks halten wir sie einen Tag lang nur als nicht rückrechenbaren Hash. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (sichere Auslieferung).",
    heading("Was wir ohne Ihre Zustimmung erfahren"),
    "Weil der Link persönlich ist, speichern wir zu jedem Besuch: dass und wann die Seite geöffnet wurde, ob über QR-Code, Kurzlink oder einen weitergeleiteten Link, ob es ein wiederholter Besuch ist, Gerätetyp, Browser und Betriebssystem (aus der Browserkennung) und den ungefähren Ort auf Ebene der Stadt (von unserem Dienstleister Cloudflare aus der IP-Adresse ermittelt; die IP-Adresse selbst speichern wir nicht). Außerdem, was Sie uns selbst schicken (Chat und Rückruf, unten), ob Sie sich einen Link zum Teilen erzeugt oder „Kein Interesse“ gewählt haben. Dafür wird auf Ihrem Gerät nichts gespeichert oder ausgelesen. So sehen wir, ob unser Brief angekommen ist, und können uns zu einem passenden Zeitpunkt melden. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.",
    heading("Lesestatistik, nur mit Ihrer Zustimmung"),
    `Wenn Sie im Hinweis „Einverstanden“ wählen oder die Lesestatistik einschalten, misst diese Seite zusätzlich: welche Abschnitte Sie wie lange sehen, wie weit Sie scrollen, wie lange die Seite aktiv geöffnet ist, ob Sie Kontaktwege ansteuern, anklicken oder eine Nummer bzw. Adresse kopieren (nicht den Inhalt Ihrer Zwischenablage), ob Sie Preisoptionen wählen, ein Video starten, die Seite als PDF laden oder Hinweise auf der Seite sehen und anklicken, und ob Sie im Chat angefangen haben zu schreiben, ohne zu senden (nie was und nicht wie viel). Solange die Seite offen ist, sehen wir, dass Sie gerade da sind, nicht was Sie im Einzelnen tun. Cookies setzen wir dafür nicht. Rechtsgrundlage: Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, ${rule}). Ohne Zustimmung findet nichts davon statt, und Sie können die Seite trotzdem vollständig nutzen. Erhalten wir von Ihrem Browser das Signal „Global Privacy Control“, behandeln wir das wie eine Ablehnung.`,
    settings.replay.enabled ? heading("Aufzeichnung, nur mit Ihrer Zustimmung") : null,
    settings.replay.enabled
      ? `Wenn Sie die Aufzeichnung einschalten, zeichnen wir auf, wie Sie auf dieser Seite scrollen, klicken und die Maus bewegen, um zu sehen, was verständlich ist und was nicht. Eingaben in Feldern, der Chat und das Rückrufformular werden nicht aufgezeichnet. Wir löschen die Aufzeichnung nach ${replaysDays} Tagen, sofort, wenn Sie widerrufen. Rechtsgrundlage: Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, ${rule}).`
      : null,
    heading("Chat"),
    `Was Sie im Chat senden, speichern wir, um Ihnen zu antworten. Ihr Browser merkt sich für diesen Tab den Zugang zu Ihrem Gespräch (Session Storage), damit es beim Neuladen nicht verloren geht; das ist für den Chat, den Sie nutzen, erforderlich (${deviceException(country)}) und endet mit dem Schließen des Tabs. Rechtsgrundlage: Art. 6 Abs. 1 lit. b und f DSGVO (Ihre Anfrage).`,
    heading("Rückruf und andere Kontaktwege"),
    `Im Rückrufformular speichern wir Name, Telefonnummer, Wunschzeit und Ihre Nachricht, um Sie zurückzurufen.${!settings.chat.prefillCallbackPhone ? "" : " Ist uns bereits eine Nummer Ihres Unternehmens bekannt, zeigt das Formular sie nur gekürzt an."} Wenn Sie uns per E-Mail oder Telefon kontaktieren, verarbeiten wir Ihre Angaben, um Ihre Anfrage zu bearbeiten.${settings.channels.whatsapp ? " Der Knopf „WhatsApp“ öffnet WhatsApp, einen Dienst der WhatsApp Ireland Ltd. (Meta); dort gilt deren Datenschutzerklärung." : ""} Rechtsgrundlage: Art. 6 Abs. 1 lit. b und f DSGVO.`,
    heading("Wie wir Ihr Interesse einschätzen"),
    "Aus den oben beschriebenen Daten berechnen wir einen internen Wert, wie wahrscheinlich Sie Kontakt wünschen, und erhalten eine Benachrichtigung, wenn er steigt. Er dient nur der Reihenfolge und dem Zeitpunkt unserer Rückmeldung; eine Entscheidung mit rechtlicher Wirkung für Sie trifft er nicht (Art. 22 DSGVO). Ohne Ihre Zustimmung zur Lesestatistik beruht er nur auf dem, was wir ohne Zustimmung erfahren, und auf Chat und Rückruf. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO, für den Anteil aus der Lesestatistik Ihre Einwilligung.",
    heading("Was auf Ihrem Gerät gespeichert wird"),
    "Cookies setzen wir auf dieser Seite nicht. Im Local Storage Ihres Browsers steht unter „aq-consent“ nur Ihre Datenschutz-Entscheidung mit Datum und Version des Hinweises, ohne Kennung, damit wir Sie nicht bei jedem Besuch fragen (erforderlich, um Ihre Entscheidung zu beachten; nach 180 Tagen fragen wir erneut). Wenn Sie den Chat nutzen, steht im Session Storage unter „aq-chat:…“ der Zugang zu Ihrem Gespräch, bis Sie den Tab schließen.",
    heading("Dienstleister"),
    `Wir setzen Auftragsverarbeiter ein, mit denen Verträge nach Art. 28 DSGVO bestehen: ${PROCESSOR_LIST[hosting]}. Cloudflare ist ein US-Unternehmen; die Übermittlung stützt sich auf den Angemessenheitsbeschluss zum EU-US Data Privacy Framework. Ihre Daten verkaufen oder teilen wir nicht.`,
    heading("Wie lange wir speichern"),
    `Einzelne Messwerte der Lesestatistik löschen wir nach ${eventsDays} Tagen.${settings.replay.enabled ? ` Aufzeichnungen nach ${replaysDays} Tagen.` : ""} Basisdaten zu Besuchen löschen wir, sobald wir Ihr Unternehmen aus unserer Akquise entfernen. Nachrichten und Rückrufwünsche bewahren wir auf, solange es für die Korrespondenz nötig ist, bei einem Auftrag nach den gesetzlichen Aufbewahrungsfristen. Wenn Sie widersprechen, löschen wir alle Besuchsdaten nach ${optOutTrackingDays} Tagen und behalten nur einen Vermerk, Sie nicht mehr anzuschreiben.`,
    heading("Ihre Rechte"),
    `Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit (Art. 15 bis 20 DSGVO). Eine Einwilligung können Sie jederzeit über „Datenschutz-Einstellungen“ am Ende der Seite widerrufen; die Daten der Lesestatistik dieses Besuchs löschen wir dann sofort${settings.replay.enabled ? ", ebenso die Aufzeichnung" : ""}. Der Widerruf berührt nicht die Rechtmäßigkeit der Verarbeitung bis dahin. ${ask}`,
    `**Widerspruchsrecht (Art. 21 DSGVO).** Sie können der Verarbeitung Ihrer Daten für Werbung jederzeit ohne Begründung widersprechen, am einfachsten über den Link „Kein Interesse, bitte nicht mehr kontaktieren“ am Ende dieser Seite${email ? ` oder an ${email}` : ""}. Wir schreiben Sie dann nicht mehr an und erfassen keine Besuche mehr.`,
    `**Beschwerde.** Sie können sich bei einer Datenschutz-Aufsichtsbehörde beschweren, etwa in Ihrem Land. ${authority(country)}`.trim(),
    heading("Müssen Sie Daten angeben?"),
    "Nein. Sie können diese Seite ohne Angaben und ohne Zustimmung vollständig lesen. Nur für Chat und Rückruf brauchen wir, was Sie dort eingeben.",
  ]
    .filter((part): part is string | Heading => Boolean(part))
    .map((part) => (typeof part === "string" ? part : `**${++number}. ${part.title}**`))
    .join("\n\n");
}
