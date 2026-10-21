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
  /** The workspace sends its letters through Pingen (§7.9). */
  printService: "pingen" | null = null,
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
    "**Was diese Seite misst.** Ohne Cookies und ohne etwas auf Ihrem Gerät zu speichern, erfassen wir, wie Sie auf die Seite gekommen sind (QR-Code, Kurzlink, weitergeleitet), Gerätetyp, Browser, Betriebssystem und den ungefähren Ort (Stadt), welche Abschnitte Sie wie lange gelesen haben und ob Sie auf einen Kontaktweg geklickt oder eine Nummer kopiert haben. So sehen wir, ob unser Brief angekommen ist, und können uns zum passenden Zeitpunkt melden. Daraus ergibt sich ein interner Wert für Ihr Interesse; er dient nur der Reihenfolge unserer Rückmeldungen, eine automatisierte Entscheidung über Sie trifft er nicht.",
    settings.chat.storeDraftContent
      ? "**Chat und Rückruf.** Was Sie im Chat schreiben oder im Rückrufformular angeben, speichern wir, um Ihnen zu antworten. Im Chat speichern wir auch Text, den Sie getippt, aber nicht gesendet haben; darauf weist das Chatfenster hin."
      : "**Chat und Rückruf.** Was Sie im Chat schreiben oder im Rückrufformular angeben, speichern wir, um Ihnen zu antworten. Von getipptem, aber nicht gesendetem Text erfahren wir nur die Länge, nie den Inhalt.",
    settings.replay.enabled
      ? "**Aufzeichnung nur mit Ihrer Erlaubnis.** Auf der Seite fragen wir, ob wir aufzeichnen dürfen, wie Sie scrollen und klicken. Nur wenn Sie zustimmen (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG), entsteht eine Aufzeichnung dieses Besuchs; Eingaben in Feldern und der Chat werden nicht aufgezeichnet. Ihr Browser merkt sich nur Ihre Entscheidung, damit wir nicht erneut fragen. Sie können jederzeit über „Aufzeichnung beenden“ widerrufen; die Aufzeichnung wird dann gelöscht, sonst spätestens nach " +
        String(settings.retention.replaysDays) +
        " Tagen."
      : null,
    `**Speicherdauer.** Einzelne Messwerte löschen wir nach ${settings.retention.eventsDays} Tagen automatisch. Wenn Sie „Kein Interesse“ wählen, löschen wir alle Besuchsdaten nach ${settings.retention.optOutTrackingDays} Tagen und behalten nur den Vermerk, Sie nicht mehr zu kontaktieren. Nachrichten bewahren wir auf, solange es für die Korrespondenz nötig ist.`,
    `**Dienstleister.** ${PROCESSORS[hosting]}, Fehlerberichte ohne personenbezogene Daten über Sentry (EU)${printService === "pingen" ? ", Druck und Versand unserer Briefe über Pingen (Schweiz und EU), dafür erhält Pingen Ihre Anschrift" : ""}. Mit allen bestehen Verträge zur Auftragsverarbeitung.`,
    "**Ihre Rechte.** Sie können Auskunft (auch als Datei), Berichtigung, Löschung und Einschränkung verlangen und der Verarbeitung widersprechen. Über den Link „Kein Interesse“ am Ende des Exposés widersprechen Sie mit einem Klick; wir kontaktieren Sie dann nicht mehr. Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
