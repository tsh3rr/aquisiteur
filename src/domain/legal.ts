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

export function privacyMarkdown(settings: WorkspaceSettings, workspaceName: string): string {
  if (settings.legal.privacyMarkdown) return settings.legal.privacyMarkdown;
  const controller = settings.senderAddress.company ?? workspaceName;
  const contact = settings.channels.email
    ? ` Sie erreichen uns unter ${settings.channels.email}.`
    : "";
  return [
    `**Verantwortlich** für diese Seite ist ${controller} (siehe Impressum).${contact}`,
    "**Worum es geht.** Sie haben von uns per Post persönliche Vorschläge für Ihr Unternehmen erhalten. Diese Seite zeigt sie Ihnen. Wir stützen die Verarbeitung auf unser berechtigtes Interesse, Ihnen ein passendes Angebot zu machen (Art. 6 Abs. 1 lit. f DSGVO).",
    "**Welche Daten wir verarbeiten.** Firmenname, Anschrift und Ansprechpartner, wie sie öffentlich zugänglich sind. Beim Aufruf dieser Seite verarbeitet unser Hosting-Dienstleister technisch notwendige Daten (z. B. IP-Adresse) nur für die Auslieferung. Wir speichern keine Cookies und lesen nichts von Ihrem Gerät aus.",
    settings.replay.enabled
      ? "**Aufzeichnung nur mit Ihrer Erlaubnis.** Auf der Seite fragen wir, ob wir aufzeichnen dürfen, wie Sie scrollen und klicken. Nur wenn Sie zustimmen (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG), entsteht eine Aufzeichnung dieses Besuchs; Eingaben in Feldern und der Chat werden nicht aufgezeichnet. Ihr Browser merkt sich nur Ihre Entscheidung, damit wir nicht erneut fragen. Sie können jederzeit über „Aufzeichnung beenden“ widerrufen; die Aufzeichnung wird dann gelöscht, sonst spätestens nach " +
        String(settings.retention.replaysDays) +
        " Tagen."
      : null,
    "**Dienstleister.** Hosting über Cloudflare, Datenbank bei Supabase in Frankfurt (EU). Mit beiden bestehen Verträge zur Auftragsverarbeitung.",
    "**Ihre Rechte.** Sie können Auskunft, Berichtigung, Löschung und Einschränkung verlangen und der Verarbeitung widersprechen. Über den Link „Kein Interesse“ am Ende des Exposés widersprechen Sie mit einem Klick; wir kontaktieren Sie dann nicht mehr. Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
