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
  const ask = email
    ? `Hierzu genügt eine Nachricht an ${email}.`
    : "Hierzu genügt eine formlose Nachricht.";
  const { eventsDays, replaysDays, optOutTrackingDays } = settings.retention;
  let number = 0;
  return [
    heading("Verantwortlicher"),
    [
      "Verantwortlicher im Sinne des Art. 4 Nr. 7 DSGVO ist " +
        [controller, settings.profile.displayName, address.street, place]
          .filter(Boolean)
          .join(", ") +
        " (siehe Impressum).",
      reach.join(", "),
    ]
      .filter(Boolean)
      .join(" "),
    heading("Gegenstand dieser Erklärung"),
    "Sie haben von uns per Post ein auf Ihr Unternehmen zugeschnittenes Angebot erhalten, das diese Seite darstellt. QR-Code und Kurzlink im Schreiben sind ausschließlich Ihrem Unternehmen zugeordnet; Aufrufe dieser Seite können wir daher Ihrem Unternehmen zuordnen. Diese Erklärung informiert Sie nach Art. 13 und 14 DSGVO darüber, welche Daten wir ohne Ihre Einwilligung verarbeiten, welche nur mit Ihrer Einwilligung, und wie Sie widersprechen können.",
    heading("Herkunft und Zweck der Daten"),
    `Firmenname, Anschrift und gegebenenfalls den Namen der Ansprechperson haben wir aus ${settings.legal.dataSource ?? DEFAULT_DATA_SOURCE} erhoben. Wir verarbeiten diese Daten, um Ihnen ein Angebot über unsere Leistungen zu übermitteln. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt in der Direktwerbung für unsere Leistungen (Erwägungsgrund 47 DSGVO).`,
    heading("Bereitstellung der Seite"),
    "Beim Aufruf der Seite verarbeitet unser Hosting-Dienstleister technisch erforderliche Daten (IP-Adresse, Zeitpunkt, aufgerufene Adresse, Browserkennung), um die Seite auszuliefern. Die IP-Adresse wird von uns nicht gespeichert. Zum Schutz vor dem systematischen Ausprobieren von Kurzlinks wird sie für einen Tag ausschließlich als nicht umkehrbarer Hashwert vorgehalten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt in der sicheren Bereitstellung der Seite.",
    heading("Verarbeitung ohne Einwilligung"),
    "Zu jedem Aufruf speichern wir: Zeitpunkt des Aufrufs, Zugangsweg (QR-Code, Kurzlink oder weitergeleiteter Link), ob es sich um einen wiederholten Aufruf handelt, Gerätetyp, Browser und Betriebssystem (aus der Browserkennung) sowie den ungefähren Standort auf Ebene der Stadt (von unserem Dienstleister Cloudflare aus der IP-Adresse abgeleitet; die IP-Adresse selbst wird nicht gespeichert). Darüber hinaus verarbeiten wir die Angaben, die Sie uns aktiv übermitteln (Chat und Rückruf, siehe unten), sowie die Information, ob Sie einen Link zum Teilen erzeugt oder „Kein Interesse“ gewählt haben. Hierfür werden auf Ihrem Endgerät keine Informationen gespeichert oder ausgelesen. Zweck ist festzustellen, ob unser Schreiben Sie erreicht hat, um uns zu einem geeigneten Zeitpunkt bei Ihnen zu melden. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.",
    heading("Lesestatistik (nur mit Einwilligung)"),
    `Wenn Sie im Datenschutzhinweis „Akzeptieren“ wählen oder die Lesestatistik in den Einstellungen aktivieren, erfasst diese Seite zusätzlich: welche Abschnitte Sie wie lange ansehen, die Scrolltiefe, die Dauer der aktiven Nutzung, ob Sie Kontaktwege ansteuern, anklicken oder eine Telefonnummer bzw. Adresse kopieren (nicht den Inhalt Ihrer Zwischenablage), ob Sie Preisoptionen wählen, ein Video starten, die Seite als PDF herunterladen oder Hinweise auf der Seite sehen und anklicken, sowie ob Sie im Chat mit einer Eingabe begonnen haben, ohne sie abzusenden (weder Inhalt noch Länge der Eingabe). Während die Seite geöffnet ist, ist für uns erkennbar, dass Sie die Seite gerade nutzen, nicht jedoch Ihre einzelnen Handlungen. Cookies werden hierfür nicht eingesetzt. Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, ${rule}). Ohne Einwilligung findet diese Verarbeitung nicht statt; die Seite bleibt uneingeschränkt nutzbar. Ein von Ihrem Browser übermitteltes Signal „Global Privacy Control“ behandeln wir als Ablehnung.`,
    settings.replay.enabled ? heading("Sitzungsaufzeichnung (nur mit Einwilligung)") : null,
    settings.replay.enabled
      ? `Wenn Sie die Sitzungsaufzeichnung aktivieren, zeichnen wir Scrollen, Klicks und Mausbewegungen auf dieser Seite auf, um die Verständlichkeit unseres Angebots zu verbessern. Eingaben in Formularfeldern, der Chat und das Rückrufformular werden nicht aufgezeichnet. Die Aufzeichnung wird nach ${replaysDays} Tagen gelöscht, im Fall eines Widerrufs unverzüglich. Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, ${rule}).`
      : null,
    heading("Chat"),
    `Nachrichten, die Sie über den Chat senden, speichern wir zur Beantwortung Ihrer Anfrage. Ihr Browser speichert für die Dauer des geöffneten Tabs einen Zugangsschlüssel zu Ihrem Gespräch (Session Storage), damit das Gespräch beim Neuladen erhalten bleibt; dies ist für den von Ihnen genutzten Chat unbedingt erforderlich (${deviceException(country)}) und endet mit dem Schließen des Tabs. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und f DSGVO.`,
    heading("Rückruf und weitere Kontaktwege"),
    `Über das Rückrufformular verarbeiten wir Name, Telefonnummer, gewünschten Zeitraum und Ihre Nachricht, um Sie zurückzurufen.${!settings.chat.prefillCallbackPhone ? "" : " Ist uns bereits eine Telefonnummer Ihres Unternehmens bekannt, wird diese im Formular nur gekürzt angezeigt."} Bei einer Kontaktaufnahme per E-Mail oder Telefon verarbeiten wir Ihre Angaben zur Bearbeitung Ihrer Anfrage.${settings.channels.whatsapp ? " Die Schaltfläche „WhatsApp“ öffnet den Dienst der WhatsApp Ireland Ltd. (Meta); für die dortige Verarbeitung gilt deren Datenschutzerklärung." : ""} Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und f DSGVO.`,
    heading("Einschätzung des Kontaktinteresses"),
    "Aus den vorstehend beschriebenen Daten ermitteln wir einen internen Wert dafür, wie wahrscheinlich ein Kontaktwunsch besteht, und werden bei einem Anstieg benachrichtigt. Der Wert bestimmt ausschließlich Reihenfolge und Zeitpunkt unserer Kontaktaufnahme; eine automatisierte Entscheidung mit rechtlicher oder ähnlich erheblicher Wirkung im Sinne des Art. 22 DSGVO findet nicht statt. Ohne Einwilligung in die Lesestatistik beruht der Wert nur auf den ohne Einwilligung verarbeiteten Daten sowie auf Chat und Rückruf. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO, für den auf der Lesestatistik beruhenden Anteil Ihre Einwilligung.",
    heading("Speicherung auf Ihrem Endgerät"),
    "Cookies werden auf dieser Seite nicht gesetzt. Im Local Storage Ihres Browsers wird unter „aq-consent“ ausschließlich Ihre Datenschutz-Auswahl mit Datum und Version des Hinweises gespeichert, ohne Kennung. Dies ist erforderlich, um Ihre Auswahl bei weiteren Aufrufen zu beachten; nach 180 Tagen wird die Auswahl erneut abgefragt. Bei Nutzung des Chats wird im Session Storage unter „aq-chat:…“ der Zugangsschlüssel zu Ihrem Gespräch gespeichert, bis Sie den Tab schließen.",
    heading("Empfänger und Auftragsverarbeiter"),
    `Wir setzen Auftragsverarbeiter ein, mit denen Verträge nach Art. 28 DSGVO bestehen: ${PROCESSOR_LIST[hosting]}. Cloudflare hat seinen Sitz in den USA; eine Übermittlung erfolgt auf Grundlage des Angemessenheitsbeschlusses der Europäischen Kommission zum EU-US Data Privacy Framework (Art. 45 DSGVO). Eine Weitergabe oder ein Verkauf Ihrer Daten an Dritte findet nicht statt.`,
    heading("Speicherdauer"),
    `Einzelne Messwerte der Lesestatistik werden nach ${eventsDays} Tagen gelöscht.${settings.replay.enabled ? ` Sitzungsaufzeichnungen werden nach ${replaysDays} Tagen gelöscht.` : ""} Die ohne Einwilligung gespeicherten Daten zu Aufrufen löschen wir, sobald wir Ihr Unternehmen aus unserer Akquise entfernen. Nachrichten und Rückrufwünsche bewahren wir auf, solange dies für die Korrespondenz erforderlich ist, im Fall eines Auftrags für die Dauer der gesetzlichen Aufbewahrungsfristen. Nach einem Widerspruch löschen wir sämtliche Daten zu Aufrufen nach ${optOutTrackingDays} Tagen und bewahren lediglich einen Sperrvermerk auf, um Sie nicht erneut anzuschreiben.`,
    heading("Ihre Rechte"),
    `Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit (Art. 15 bis 20 DSGVO). Eine erteilte Einwilligung können Sie jederzeit mit Wirkung für die Zukunft über „Datenschutz-Einstellungen“ am Ende der Seite widerrufen (Art. 7 Abs. 3 DSGVO); die Daten der Lesestatistik dieses Besuchs${settings.replay.enabled ? " und eine Sitzungsaufzeichnung" : ""} werden dann unverzüglich gelöscht. Die Rechtmäßigkeit der bis zum Widerruf erfolgten Verarbeitung bleibt unberührt. ${ask}`,
    `**Widerspruchsrecht (Art. 21 DSGVO).** Sie können der Verarbeitung Ihrer Daten zum Zweck der Direktwerbung jederzeit ohne Angabe von Gründen widersprechen, insbesondere über den Link „Kein Interesse, bitte nicht mehr kontaktieren“ am Ende dieser Seite${email ? ` oder per E-Mail an ${email}` : ""}. Wir werden Sie dann nicht mehr anschreiben und keine Aufrufe mehr erfassen.`,
    `**Beschwerderecht (Art. 77 DSGVO).** Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, insbesondere in dem Mitgliedstaat Ihres Aufenthaltsorts oder Arbeitsplatzes. ${authority(country)}`.trim(),
    heading("Pflicht zur Bereitstellung"),
    "Sie sind nicht verpflichtet, Daten bereitzustellen. Die Seite kann ohne Angaben und ohne Einwilligung vollständig genutzt werden. Für Chat und Rückruf benötigen wir die dort von Ihnen eingegebenen Angaben.",
  ]
    .filter((part): part is string | Heading => Boolean(part))
    .map((part) => (typeof part === "string" ? part : `**${++number}. ${part.title}**`))
    .join("\n\n");
}
