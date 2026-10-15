# Datenschutz (technische Umsetzung)

> Keine Rechtsberatung. Vor dem Livegang von einer Fachperson prüfen lassen. Dieses Dokument wird mit
> jeder Phase ergänzt und ist in Phase 6 vollständig.

## Stand Phase 1

| Thema                     | Umsetzung                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Speicherort               | Alle personenbezogenen Daten in Postgres bei Supabase, Region Frankfurt.                                                                                                       |
| Cockpit-Cookies           | Nur technisch notwendige: Session (`aq.session_token`, httpOnly, SameSite=Lax), aktiver Workspace (`aq_ws`), Farbschema (`aq_theme`), Passkey-Challenge während der Anmeldung. |
| IP-Adressen               | Werden in Sessions nicht gespeichert. Für das Rate Limiting der Anmeldung kurzzeitig als Schlüssel in `rate_limits`; Bereinigung mit den Retention-Jobs (Phase 6).             |
| Anmeldelinks              | 10 Minuten gültig, einmalig, nur als Hash gespeichert.                                                                                                                         |
| Indexierung               | Alle Seiten senden `X-Robots-Tag: noindex, nofollow`.                                                                                                                          |
| Mandantentrennung         | Row Level Security, siehe [ARCHITECTURE.md](./ARCHITECTURE.md#mandantentrennung-9a).                                                                                           |
| Audit-Log                 | Pro Workspace, für Mandanten nur anfügbar.                                                                                                                                     |
| Secrets von Integrationen | AES-256-GCM, Schlüssel nur in der Laufzeitumgebung.                                                                                                                            |
| Exposés                   | Keine Cookies, kein Tracking (kommt cookieless in Phase 2), `noindex`. Prospect-Daten stammen aus der `expose.json` und liegen pro Workspace mit RLS in Postgres.              |
| Bilder und Videos         | Privater R2-Bucket (EU), Pfad pro Workspace. Ausgeliefert nur über die App und nur für den Host des eigenen Workspaces. SVGs werden vor dem Upload gerastert.                  |
| Widerspruch (Opt-out)     | Link „Kein Interesse“ in jedem Exposé; nach Bestätigung `status = no_interest` und `do_not_contact_at` am Prospect, Eintrag im Audit-Log. Keine IP, kein Cookie.               |
| API-Tokens                | Nur als SHA-256-Hash gespeichert, einmalig angezeigt, ablaufend oder widerrufbar, handeln mit den Rechten ihres Erstellers.                                                    |

## Auftragsverarbeiter

| Dienst           | Zweck                                             | Region               | AVV                                     |
| ---------------- | ------------------------------------------------- | -------------------- | --------------------------------------- |
| Supabase         | Datenbank                                         | EU (Frankfurt)       | DPA im Dashboard abschließen            |
| Cloudflare       | Hosting, Hyperdrive, R2 (Dateien), später Queues  | global, R2 in EU     | DPA ist Teil der Self-Serve-Bedingungen |
| Resend           | E-Mail-Versand (Anmeldelinks, Benachrichtigungen) | EU (Irland)          | DPA im Dashboard                        |
| Pingen (später)  | Briefdruck und Versand                            | Schweiz / Österreich | AV-Vertrag vor Produktivbetrieb         |
| Sentry (Phase 6) | Fehler-Monitoring                                 | EU                   | DPA                                     |

## Offen bis Phase 6

Cookieless Exposé-Tracking, Consent für Session-Replay, Aufbewahrungsfristen und automatische Löschung,
Export und Löschung pro Prospect und pro Workspace, Datenschutzerklärung und Impressum pro Workspace.
