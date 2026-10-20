# Datenschutz (technische Umsetzung)

> Keine Rechtsberatung. Vor dem Livegang von einer Fachperson prüfen lassen. Stand Phase 6
> (vollständig); neue Features ergänzen dieses Dokument.

## Rollen und Rechtsgrundlagen

- **Verantwortlich** für Exposés, Tracking und Korrespondenz ist der jeweilige Workspace (in v1 die
  Agentur des Owners). Aquisiteur ist als Plattform später Auftragsverarbeiter (§9a); deshalb gibt es
  Export, Löschung, Audit-Log, Impressum und Datenschutzerklärung pro Workspace.
- **Briefwerbung und Messung im Exposé:** berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO), B2B,
  ohne Cookies und ohne Zugriff auf das Endgerät (§ 25 TDDDG greift nicht).
- **Session-Replay:** Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG), Hinweis mit zwei
  gleichwertigen Knöpfen, jederzeit widerrufbar.
- **Kontaktabsicht (Score):** nur zur Reihenfolge der Rückmeldungen; keine automatisierte Entscheidung
  mit rechtlicher Wirkung (Art. 22 DSGVO).
- **Cockpit:** Vertrag mit dem Nutzer, nur technisch notwendige Cookies.

## Datenschutzseiten

Jedes Exposé verlinkt im Fußbereich Impressum und Datenschutz des Workspaces (`/impressum`,
`/datenschutz` auf dessen Host). Beide sind unter Einstellungen → Impressum und Datenschutz als Markdown
bearbeitbar. Leer erzeugt die App sie aus den Angaben des Workspaces (`src/domain/legal.ts`): Zweck,
Rechtsgrundlage, Messwerte, Score, Chat und Entwürfe (je nach Einstellung), Aufzeichnung (nur wenn
eingeschaltet), Speicherdauer mit den eingestellten Fristen, Dienstleister, Rechte und Opt-out.

## Aufbewahrung und Löschung

| Daten                               | Frist                                                                    | Umsetzung                                   |
| ----------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| Rohereignisse (`events`)            | `retention.eventsDays`, Standard 365 Tage                                | stündlicher Job (`src/server/retention.ts`) |
| Session-Replays samt Dateien        | `retention.replaysDays`, Standard 90 Tage; bei Widerruf sofort           | stündlicher Job, Widerruf im Exposé         |
| Tracking nach Sperrvermerk          | `retention.optOutTrackingDays`, Standard 30 Tage; nur der Vermerk bleibt | stündlicher Job, setzt `tracking_purged_at` |
| Besuche (ohne IP)                   | solange der Kunde existiert                                              | Löschen des Kunden                          |
| Chats, Rückrufwünsche               | Korrespondenz; bleiben auch nach Sperrvermerk, ohne Besuchsbezug         | Löschen des Kunden                          |
| Rate-Limit-Zähler                   | 1 Tag nach dem letzten Zugriff                                           | stündlicher Job                             |
| Anmeldelinks, abgelaufene Sitzungen | 1 Tag nach Ablauf bzw. bei Ablauf                                        | stündlicher Job                             |
| Workspace                           | bis zur Löschung durch den Owner                                         | Einstellungen → Daten und Aufbewahrung      |

Die Fristen stellt der Owner unter Einstellungen → Daten und Aufbewahrung ein (ADR-0043).

## Betroffenenrechte

| Recht                          | Umsetzung                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auskunft, Datenübertragbarkeit | Kundenseite → Datenschutz → „Daten exportieren“: JSON mit allen Zeilen zum Kunden (Besuche, Ereignisse, Chats, Briefe, Audit-Log) und den Dateipfaden der Aufzeichnungen. |
| Widerspruch                    | Link „Kein Interesse“ in jedem Exposé oder Sperrvermerk von Hand; Briefe sind dann gesperrt, Tracking-Daten werden nach Frist gelöscht.                                   |
| Löschung                       | Kundenseite → „Kunden löschen …“: alle Zeilen und Aufzeichnungsdateien.                                                                                                   |
| Workspace (§9a)                | Einstellungen → „Alle Daten exportieren“ (gestreamtes JSON aller Tabellen) und „Workspace löschen …“ (Dateien unter dem Workspace-Pfad, dann alle Zeilen).                |

## Umsetzung im Detail

| Thema                     | Umsetzung                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speicherort               | Alle personenbezogenen Daten in Postgres auf dem eigenen Server bei Mikrus (Rechenzentrum in Helsinki, Finnland); Dateien und Datenbank-Backups in Cloudflare R2 mit Jurisdiktion EU (ADR-0052).                                                                                                                                                                                |
| Cockpit-Cookies           | Nur technisch notwendige: Session (`aq.session_token`, httpOnly, SameSite=Lax), aktiver Workspace (`aq_ws`), Farbschema (`aq_theme`), Passkey-Challenge während der Anmeldung.                                                                                                                                                                                                  |
| IP-Adressen               | Werden in Sessions nicht gespeichert. Für das Rate Limiting der Anmeldung kurzzeitig als Schlüssel in `rate_limits`, für den Schutz der Kurzlinks nur als Hash mit Secret; beides löscht der stündliche Job nach einem Tag.                                                                                                                                                     |
| Anmeldelinks              | 10 Minuten gültig, einmalig, nur als Hash gespeichert.                                                                                                                                                                                                                                                                                                                          |
| Indexierung               | Alle Seiten senden `X-Robots-Tag: noindex, nofollow`.                                                                                                                                                                                                                                                                                                                           |
| Mandantentrennung         | Row Level Security, siehe [ARCHITECTURE.md](./ARCHITECTURE.md#mandantentrennung-9a).                                                                                                                                                                                                                                                                                            |
| Audit-Log                 | Pro Workspace, für Mandanten nur anfügbar.                                                                                                                                                                                                                                                                                                                                      |
| Secrets von Integrationen | AES-256-GCM, Schlüssel nur in der Laufzeitumgebung.                                                                                                                                                                                                                                                                                                                             |
| Exposés                   | Keine Cookies für Interessenten, `noindex`. Prospect-Daten stammen aus der `expose.json` oder dem Cockpit und liegen pro Workspace mit RLS in Postgres.                                                                                                                                                                                                                         |
| Exposé-Tracking           | Eigenes Script ohne Cookies und ohne Storage; die Visit-ID lebt nur im Speicher der Seite. Erfasst: Einstieg (QR, Kurzlink, direkt, weitergeleitet), Gerätetyp, Browser, Betriebssystem, Stadt und Land aus dem Cloudflare-Header, gelesene Abschnitte, Scrolltiefe, aktive Zeit, Klicks auf Kontaktwege und Preisoptionen. **Keine IP-Adresse** wird gelesen oder gespeichert. |
| Bots und Vorschauen       | Link-Vorschauen, Scanner und Prefetches werden mit Grund gespeichert, aber als Bot markiert und im Cockpit standardmäßig ausgeblendet.                                                                                                                                                                                                                                          |
| Owner-Gerät               | Cookie `aq_owner` (httpOnly, 400 Tage) auf dem Exposé-Host, nur nach Klick des Owners in den Einstellungen; markiert dessen eigene Besuche als intern.                                                                                                                                                                                                                          |
| Rate Limits               | Zähler pro Visit, Touchpoint und Exposé in `rate_limits` (ohne IP).                                                                                                                                                                                                                                                                                                             |
| Bilder und Videos         | Verzeichnis auf dem eigenen Server (bei der Cloudflare-Variante privater R2-Bucket, EU), Pfad pro Workspace. Ausgeliefert nur über die App und nur für den Host des eigenen Workspaces. SVGs werden vor dem Upload gerastert.                                                                                                                                                   |
| Widerspruch (Opt-out)     | Link „Kein Interesse“ in jedem Exposé; nach Bestätigung `status = no_interest` und `do_not_contact_at` am Prospect, Eintrag im Audit-Log. Keine IP, kein Cookie.                                                                                                                                                                                                                |
| API-Tokens                | Nur als SHA-256-Hash gespeichert, einmalig angezeigt, ablaufend oder widerrufbar, handeln mit den Rechten ihres Erstellers.                                                                                                                                                                                                                                                     |

Neu in Phase 3:

| Thema         | Umsetzung                                                                                                                                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat          | Interessenten schreiben anonym. Nachrichten liegen pro Workspace mit RLS in Postgres. Der Token des Verlaufs liegt nur in `sessionStorage` dieses Tabs (kein Cookie, endet mit dem Tab).                                                                                                                 |
| Rückkanal     | Name, Nummer oder E-Mail nur, wenn die Person sie im Chat freiwillig angibt.                                                                                                                                                                                                                             |
| Entwürfe      | Standardmäßig nur die Länge getippter, nicht gesendeter Nachrichten. Inhalt nur bei `chat.storeDraftContent`, dann mit sichtbarem Hinweis im Widget.                                                                                                                                                     |
| Rückrufwunsch | Name, Telefonnummer, Wunschzeit und optionale Nachricht. Spam-Schutz per Honeypot-Feld, keine IP. Ist beim Kunden eine Nummer hinterlegt, zeigt das Formular sie nur maskiert („+49 170 ••• 67“), weil Exposé-Links weitergeleitet werden können; die volle Nummer verlässt den Server nicht (ADR-0058). |
| Präsenz       | Letzter Heartbeat je Mitglied (`member_presence`), nur für die Anzeige „verfügbar“.                                                                                                                                                                                                                      |
| Realtime      | Auf dem eigenen Server direkt aus der App (Server-Sent Events); bei der Cloudflare-Variante Supabase Realtime (EU). Übertragen werden Nachrichtentext und Tippanzeige; gespeichert wird bei Supabase dabei nichts zusätzlich. Kanalnamen sind nicht erratbar (HMAC).                                     |

Neu in Phase 4:

| Thema                | Umsetzung                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kontaktabsicht       | Score pro Kunde aus Signalen im Exposé (Lesen, Klicks, Entwürfe, Nachrichten). Keine Daten über die Person, kein Profil über Workspaces hinweg. Eigene und Bot-Besuche zählen nicht. |
| Neue Exposé-Signale  | Hover oder Fokus auf Kontaktwegen (`cta_hover`) und Kopieren von Telefonnummer oder E-Mail-Adresse. Kein Inhalt der Zwischenablage, nur welcher Kontaktweg.                          |
| Benachrichtigungen   | Gespeichert pro Workspace mit RLS (Titel, Text, Link, Zustellung). Push-Inhalte nennen Firma und Ereignis, nie den Chat-Inhalt in voller Länge (gekürzt auf 140 Zeichen).            |
| Push-Abos            | Endpoint und Schlüssel des Browsers pro Mitglied und Gerät. Der Push-Dienst des Browsers (Google, Apple, Mozilla) sieht nur verschlüsselte Inhalte (RFC 8291).                       |
| Tageszusammenfassung | E-Mail an die Mitglieder, nur wenn in den letzten 24 Stunden etwas passiert ist.                                                                                                     |

Neu in Phase 5:

| Thema            | Umsetzung                                                                                                                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Briefe           | Brief- und Exposé-PDF entstehen im Browser (des Owners bzw. Lesers); auf dem Server liegen nur Text, Status und Versanddatum des Briefs. Kein Druckdienstleister beim `manual`-Provider.                                                                                     |
| CSV-Import       | Nur die erkannten Spalten werden übernommen, die Datei selbst wird nicht gespeichert.                                                                                                                                                                                        |
| Karte            | Die Anschrift der Firma (nicht der Person) geht einmal an OpenStreetMap Nominatim; gespeichert werden Koordinaten und Zeitpunkt. Kartenkacheln lädt der Browser des Owners von `tile.openstreetmap.org`.                                                                     |
| Einwilligung     | Für Session-Replay: Hinweis mit zwei gleichwertigen Knöpfen, nur wenn der Owner es einschaltet. Gespeichert in `consents`: Entscheidung, Textversion, Zeitpunkt, Besuch. Im Browser nur die Entscheidung (`localStorage`), keine Kennung.                                    |
| Session-Replay   | Erst nach „Ja“. Eingaben maskiert, Chat und Rückrufformular ausgeblendet. gzip-Stücke im privaten Bucket unter dem Workspace-Pfad, höchstens 8 MB pro Besuch. Löschung sofort bei Widerruf, sonst nach `retention.replaysDays` (Standard 90 Tage) durch den stündlichen Job. |
| Datenschutzseite | Die Standard-Datenschutzerklärung im Exposé erklärt die Aufzeichnung, sobald sie eingeschaltet ist.                                                                                                                                                                          |

Neu in Phase 6:

| Thema              | Umsetzung                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fehler-Monitoring  | Sentry, Region EU (Frankfurt). Gesendet werden nur Fehlertyp, Nachricht, Stack, HTTP-Methode und Routenmuster; keine Pfade, Header, Cookies, IP-Adressen oder Nutzerdaten. |
| Sperrvermerk       | Von Hand auf der Kundenseite setzbar und aufhebbar, mit Eintrag im Audit-Log.                                                                                              |
| Export und Löschen | Siehe „Betroffenenrechte“. Exporte enthalten keine Token-Hashes und keine verschlüsselten Zugangsdaten.                                                                    |
| Kurzlink-Schutz    | Zähler pro Client als Hash aus Secret und IP-Adresse, ein Tag Aufbewahrung.                                                                                                |
| System-Übersicht   | Cloudflare-Analytics wird nur gelesen (Anfragen, CPU-Zeit), keine Daten von Besuchern verlassen die App dafür.                                                             |

## Auftragsverarbeiter

| Dienst              | Zweck                                                                          | Region                                                  | AVV                                     |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------- |
| Mikrus              | Server und Datenbank                                                           | Finnland (Helsinki)                                     | AVV bei Mikrus anfragen                 |
| Cloudflare          | Proxy und DNS für alle Aufrufe (sieht IP-Adressen); R2 für Dateien und Backups | R2 in EU; Proxy weltweit (EU-US Data Privacy Framework) | DPA ist Teil der Self-Serve-Bedingungen |
| Resend              | E-Mail-Versand (Anmeldelinks, Benachrichtigungen)                              | EU (Irland)                                             | DPA im Dashboard                        |
| Sentry              | Fehler-Monitoring (ohne personenbezogene Daten)                                | EU (Frankfurt)                                          | DPA in den Organisationseinstellungen   |
| Pingen (später)     | Briefdruck und Versand                                                         | Schweiz / Österreich                                    | AV-Vertrag vor Produktivbetrieb         |
| OpenStreetMap       | Ortssuche (Nominatim) und Kartenkacheln                                        | EU (UK-Stiftung)                                        | Keine AVV; nur Firmenanschriften        |
| Push-Dienste        | Web Push an Geräte der Mitglieder                                              | Google, Apple, Mozilla                                  | Inhalte Ende-zu-Ende verschlüsselt      |
| Supabase (Variante) | Nur bei der Cloudflare-Variante: Datenbank, Realtime                           | EU (Frankfurt)                                          | DPA im Dashboard                        |

## Vor dem Livegang

1. AV-Verträge mit Mikrus, Cloudflare, Resend und Sentry abschließen.
2. Impressum und Datenschutzerklärung in den Einstellungen prüfen lassen oder durch eigene Texte ersetzen.
3. Fristen unter Einstellungen → Daten und Aufbewahrung festlegen.
4. Verzeichnis von Verarbeitungstätigkeiten um „Akquise per Brief mit Exposé“ ergänzen.
