# Datenschutz (technische Umsetzung)

> Keine Rechtsberatung. Vor dem Livegang von einer Fachperson prüfen lassen. Dieses Dokument wird mit
> jeder Phase ergänzt und ist in Phase 6 vollständig.

## Stand Phase 0

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

## Auftragsverarbeiter

| Dienst           | Zweck                                             | Region                 | AVV                                     |
| ---------------- | ------------------------------------------------- | ---------------------- | --------------------------------------- |
| Supabase         | Datenbank                                         | EU (Frankfurt)         | DPA im Dashboard abschließen            |
| Cloudflare       | Hosting, Hyperdrive, später R2/Queues             | global, Daten in EU-DB | DPA ist Teil der Self-Serve-Bedingungen |
| Resend           | E-Mail-Versand (Anmeldelinks, Benachrichtigungen) | EU (Irland)            | DPA im Dashboard                        |
| Pingen (später)  | Briefdruck und Versand                            | Schweiz / Österreich   | AV-Vertrag vor Produktivbetrieb         |
| Sentry (Phase 6) | Fehler-Monitoring                                 | EU                     | DPA                                     |

## Offen bis Phase 6

Cookieless Exposé-Tracking, Consent für Session-Replay, Aufbewahrungsfristen und automatische Löschung,
Export und Löschung pro Prospect und pro Workspace, Datenschutzerklärung und Impressum pro Workspace.
