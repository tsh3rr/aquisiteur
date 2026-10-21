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

const PROCESSORS: Record<HostingProfile, string> = {
  node: "Server und Datenbank bei Mikrus in Finnland (EU), Auslieferung über Cloudflare, Dateien bei Cloudflare R2 in der EU",
  cloudflare: "Hosting über Cloudflare, Datenbank bei Supabase in Frankfurt (EU)",
};

export function privacyMarkdown(
  settings: WorkspaceSettings,
  workspaceName: string,
  hosting: HostingProfile = "node",
): string {
  if (settings.legal.privacyMarkdown) return settings.legal.privacyMarkdown;
  const controller = settings.senderAddress.company ?? workspaceName;
  const contact = settings.channels.email
    ? ` Sie erreichen uns unter ${settings.channels.email}.`
    : "";
  return [
    `**Verantwortlich** für diese Seite ist ${controller} (siehe Impressum).${contact}`,
    "**Worum es geht.** Sie haben von uns per Post persönliche Vorschläge für Ihr Unternehmen erhalten. Diese Seite zeigt sie Ihnen. Wir stützen die Verarbeitung auf unser berechtigtes Interesse, Ihnen ein passendes Angebot zu machen (Art. 6 Abs. 1 lit. f DSGVO).",
    "**Welche Daten wir verarbeiten.** Firmenname, Anschrift und Ansprechpartner, wie sie öffentlich zugänglich sind. Beim Aufruf dieser Seite verarbeitet unser Hosting-Dienstleister technisch notwendige Daten (z. B. IP-Adresse) nur für die Auslieferung; wir speichern keine IP-Adressen.",
    "**Was diese Seite misst.** Der Link in Ihrem Brief ist persönlich, deshalb ordnen wir Besuche Ihrem Unternehmen zu. Ohne Cookies erfassen wir: wie Sie auf die Seite gekommen sind (QR-Code, Kurzlink, weitergeleiteter Link), Zeitpunkt und Dauer des Besuchs und ob Sie wiederkommen, Gerätetyp, Browser, Betriebssystem und den ungefähren Ort (Stadt, aus der IP-Adresse ermittelt, die wir danach verwerfen), welche Abschnitte Sie wie lange gelesen haben und wie weit Sie gescrollt haben, ob Sie einen Kontakt-Button angesteuert oder angeklickt, eine Nummer oder Adresse kopiert, Preisoptionen gewählt, ein Video gestartet, die Seite geteilt oder als PDF geladen haben, ob Sie Hinweise auf der Seite gesehen oder angeklickt, den Chat geöffnet oder das Rückrufformular begonnen haben. Während Sie die Seite geöffnet haben, sehen wir nur, dass Sie gerade da sind, nicht was Sie im Einzelnen tun. So sehen wir, ob unser Brief angekommen ist, und können uns zum passenden Zeitpunkt melden. Daraus ergibt sich ein interner Wert für Ihr Interesse; er dient nur der Reihenfolge unserer Rückmeldungen, eine automatisierte Entscheidung über Sie trifft er nicht.",
    "**Chat und Rückruf.** Was Sie im Chat senden oder im Rückrufformular angeben, speichern wir, um Ihnen zu antworten. Von Text, den Sie im Chat eingeben, aber nicht senden, erfahren wir nur, dass Sie angefangen haben zu schreiben, nie den Inhalt und nicht die Länge. Wenn Sie den Chat nutzen, merkt sich Ihr Browser für diesen Tab den Zugang zu Ihrem Gespräch (Session Storage), damit es beim Neuladen nicht verloren geht; das ist für den Chat nötig (§ 25 Abs. 2 Nr. 2 TDDDG) und endet mit dem Schließen des Tabs.",
    settings.replay.enabled
      ? "**Aufzeichnung nur mit Ihrer Erlaubnis.** Auf der Seite fragen wir, ob wir aufzeichnen dürfen, wie Sie scrollen und klicken. Nur wenn Sie zustimmen (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG), entsteht eine Aufzeichnung dieses Besuchs; Eingaben in Feldern und der Chat werden nicht aufgezeichnet. Ihr Browser merkt sich nur Ihre Entscheidung, damit wir nicht erneut fragen. Sie können jederzeit über „Aufzeichnung beenden“ widerrufen; die Aufzeichnung wird dann gelöscht, sonst spätestens nach " +
        String(settings.retention.replaysDays) +
        " Tagen."
      : null,
    `**Speicherdauer.** Einzelne Messwerte löschen wir nach ${settings.retention.eventsDays} Tagen automatisch. Wenn Sie „Kein Interesse“ wählen, löschen wir alle Besuchsdaten nach ${settings.retention.optOutTrackingDays} Tagen und behalten nur den Vermerk, Sie nicht mehr zu kontaktieren. Nachrichten bewahren wir auf, solange es für die Korrespondenz nötig ist.`,
    `**Dienstleister.** ${PROCESSORS[hosting]}, Fehlerberichte ohne personenbezogene Daten über Sentry (EU). Mit allen bestehen Verträge zur Auftragsverarbeitung.`,
    "**Ihre Rechte.** Sie können Auskunft (auch als Datei), Berichtigung, Löschung und Einschränkung verlangen und der Verarbeitung widersprechen. Über den Link „Kein Interesse“ am Ende des Exposés widersprechen Sie mit einem Klick; wir kontaktieren Sie dann nicht mehr. Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
