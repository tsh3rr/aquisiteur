# Datenschutz (technische Umsetzung)

> Keine Rechtsberatung. Vor dem Livegang von einer Fachperson prüfen lassen. Dieses Dokument wird mit
> jeder Phase ergänzt und ist in Phase 6 vollständig.

## Stand Phase 4

| Thema                     | Umsetzung                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speicherort               | Alle personenbezogenen Daten in Postgres bei Supabase, Region Frankfurt.                                                                                                                                                                                                                                                                                                        |
| Cockpit-Cookies           | Nur technisch notwendige: Session (`aq.session_token`, httpOnly, SameSite=Lax), aktiver Workspace (`aq_ws`), Farbschema (`aq_theme`), Passkey-Challenge während der Anmeldung.                                                                                                                                                                                                  |
| IP-Adressen               | Werden in Sessions nicht gespeichert. Für das Rate Limiting der Anmeldung kurzzeitig als Schlüssel in `rate_limits`; Bereinigung mit den Retention-Jobs (Phase 6).                                                                                                                                                                                                              |
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
| Bilder und Videos         | Privater R2-Bucket (EU), Pfad pro Workspace. Ausgeliefert nur über die App und nur für den Host des eigenen Workspaces. SVGs werden vor dem Upload gerastert.                                                                                                                                                                                                                   |
| Widerspruch (Opt-out)     | Link „Kein Interesse“ in jedem Exposé; nach Bestätigung `status = no_interest` und `do_not_contact_at` am Prospect, Eintrag im Audit-Log. Keine IP, kein Cookie.                                                                                                                                                                                                                |
| API-Tokens                | Nur als SHA-256-Hash gespeichert, einmalig angezeigt, ablaufend oder widerrufbar, handeln mit den Rechten ihres Erstellers.                                                                                                                                                                                                                                                     |

Neu in Phase 3:

| Thema         | Umsetzung                                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat          | Interessenten schreiben anonym. Nachrichten liegen pro Workspace mit RLS in Postgres. Der Token des Verlaufs liegt nur in `sessionStorage` dieses Tabs (kein Cookie, endet mit dem Tab). |
| Rückkanal     | Name, Nummer oder E-Mail nur, wenn die Person sie im Chat freiwillig angibt.                                                                                                             |
| Entwürfe      | Standardmäßig nur die Länge getippter, nicht gesendeter Nachrichten. Inhalt nur bei `chat.storeDraftContent`, dann mit sichtbarem Hinweis im Widget.                                     |
| Rückrufwunsch | Name, Telefonnummer, Wunschzeit und optionale Nachricht. Spam-Schutz per Honeypot-Feld, keine IP.                                                                                        |
| Präsenz       | Letzter Heartbeat je Mitglied (`member_presence`), nur für die Anzeige „verfügbar“.                                                                                                      |
| Realtime      | In Produktion Supabase Realtime (EU). Übertragen werden Nachrichtentext und Tippanzeige; gespeichert wird bei Supabase dabei nichts zusätzlich. Kanalnamen sind nicht erratbar (HMAC).   |

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
| Briefe           | Das PDF entsteht im Browser des Owners; auf dem Server liegen nur Text, Status und Versanddatum des Briefs. Kein Druckdienstleister beim `manual`-Provider.                                                                                                                  |
| CSV-Import       | Nur die erkannten Spalten werden übernommen, die Datei selbst wird nicht gespeichert.                                                                                                                                                                                        |
| Karte            | Die Anschrift der Firma (nicht der Person) geht einmal an OpenStreetMap Nominatim; gespeichert werden Koordinaten und Zeitpunkt. Kartenkacheln lädt der Browser des Owners von `tile.openstreetmap.org`.                                                                     |
| Einwilligung     | Für Session-Replay: Hinweis mit zwei gleichwertigen Knöpfen, nur wenn der Owner es einschaltet. Gespeichert in `consents`: Entscheidung, Textversion, Zeitpunkt, Besuch. Im Browser nur die Entscheidung (`localStorage`), keine Kennung.                                    |
| Session-Replay   | Erst nach „Ja“. Eingaben maskiert, Chat und Rückrufformular ausgeblendet. gzip-Stücke im privaten Bucket unter dem Workspace-Pfad, höchstens 8 MB pro Besuch. Löschung sofort bei Widerruf, sonst nach `retention.replaysDays` (Standard 90 Tage) durch den stündlichen Job. |
| Datenschutzseite | Die Standard-Datenschutzerklärung im Exposé erklärt die Aufzeichnung, sobald sie eingeschaltet ist.                                                                                                                                                                          |

## Auftragsverarbeiter

| Dienst           | Zweck                                             | Region               | AVV                                     |
| ---------------- | ------------------------------------------------- | -------------------- | --------------------------------------- |
| Supabase         | Datenbank, Realtime (Chat)                        | EU (Frankfurt)       | DPA im Dashboard abschließen            |
| Cloudflare       | Hosting, Hyperdrive, R2 (Dateien), später Queues  | global, R2 in EU     | DPA ist Teil der Self-Serve-Bedingungen |
| Resend           | E-Mail-Versand (Anmeldelinks, Benachrichtigungen) | EU (Irland)          | DPA im Dashboard                        |
| Pingen (später)  | Briefdruck und Versand                            | Schweiz / Österreich | AV-Vertrag vor Produktivbetrieb         |
| Sentry (Phase 6) | Fehler-Monitoring                                 | EU                   | DPA                                     |
| OpenStreetMap    | Ortssuche (Nominatim) und Kartenkacheln           | EU (UK-Stiftung)     | Keine AVV; nur Firmenanschriften        |

## Offen bis Phase 6

Aufbewahrungsfristen und automatische Löschung für Events und `rate_limits` (Replays sind erledigt),
Export pro Prospect und pro Workspace (Löschen eines Prospects mit allen Besuchen gibt es im Cockpit), Datenschutzerklärung und Impressum pro Workspace.
