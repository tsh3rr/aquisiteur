# Aquisiteur – Zielprompt

> Dieser Prompt ist für Claude Code geschrieben (funktioniert genauso mit Codex).
> Ihn komplett lesen, bevor du irgendetwas anlegst. Abschnitt 13 sagt, wie du arbeiten sollst.

---

## 1. Deine Rolle

Du bist Lead Engineer und Product Designer für **Aquisiteur**, eine Web-App, mit der ein Einzelunternehmer (Inhaber einer kleinen Webagentur, im Folgenden „Owner“) Neukunden per **personalisiertem Brief** gewinnt. Du triffst technische Entscheidungen eigenständig im Rahmen dieses Dokuments, begründest Abweichungen kurz und baust in Phasen, die jeweils lauffähig, getestet und deploybar sind.

Qualitätsanspruch: Produktionsreife, nicht Demo. Moderne, mutige, aber ruhige UI. Barrierefrei. Schnell. Datenschutzkonform für Deutschland.

---

## 2. Das Geschäftsmodell in einem Absatz

Der Owner recherchiert ein lokales Unternehmen (z. B. ein Café mit veralteter Website), lässt mit Claude Code ein **Exposé** erstellen (konkrete, personalisierte Verbesserungsvorschläge für Website, Branding, Google-Profil, Social Media, inkl. Vorher/Nachher, Mockups, Preisrahmen) und schickt dem Unternehmen einen **Brief per Post**. Im Brief stehen ein **QR-Code** und ein **kurzer, abtippbarer Link** zur interaktiven Web-Version des Exposés. Aquisiteur hostet dieses Exposé, **erfasst jede Interaktion**, **motiviert den Empfänger an den richtigen Stellen zur Kontaktaufnahme** und **informiert den Owner sofort**, wenn jemand den Brief „öffnet“ oder Kontakt aufnehmen will, inklusive einer Einschätzung, **wie sicher** ein Kontaktversuch stattgefunden hat und **über welchen Kanal** der Owner jetzt reagieren sollte.

Der Kern der App ist also: **Hosting + Tracking + Conversion + Benachrichtigung.** Exposés *erstellt* die App in v1 nicht selbst.

---

## 3. Glossar (verwende diese Begriffe konsistent in Code und UI)

| Begriff | Bedeutung |
|---|---|
| **Prospect** | Ein potenzieller Kunde (Unternehmen) mit Ansprechpartner, Adresse, bekannten Kontaktdaten, Notizen, Status. |
| **Kampagne** | Gruppierung von Prospects (z. B. „Cafés Leipzig Okt 26“) für Auswertung. |
| **Exposé** | Die personalisierte, interaktive Web-Präsentation für genau einen Prospect. Versioniert. |
| **Touchpoint** | Ein konkreter Einstieg mit eigener Attribution: QR im Brief, Kurzlink im Brief (abgetippt), Follow-up-Brief, E-Mail, Visitenkarte … Jeder Touchpoint hat einen eigenen Link/Code. |
| **Visit / Session** | Ein Besuch des Exposés von einem Gerät. Ein Prospect kann mehrere Besucher (Geräte, Personen) haben. |
| **Event** | Eine einzelne gemessene Interaktion (Abschnitt gesehen, Chat geöffnet, getippt …). |
| **Kontaktabsicht (Intent)** | Berechnete Wahrscheinlichkeit 0–100 %, dass der Prospect Kontakt aufnehmen wollte oder es getan hat, mit Begründung. |
| **Nudge** | Eine verhaltensbasierte, dezente Aufforderung zur Kontaktaufnahme im Exposé. |
| **Cockpit** | Der Admin-Bereich des Owners. |
| **Kunde** | Ein Prospect, mit dem es ein Geschäft gibt (gewonnen oder mit angenommenem Angebot). Kein eigener Datensatz, sondern derselbe Prospect mit Rechnungsprofil. |
| **Projekt** | Ein Vorhaben bei einem Kunden (z. B. „Website-Relaunch 2026“). Bündelt Exposés, Angebote, Zahlungsplan, Wartungsverträge und Rechnungen. Ein Kunde kann mehrere Projekte haben. |
| **Angebot** | Versioniertes, verbindliches Angebot zu einem Projekt mit Positionen, optional Varianten, Zahlungsplan und Online-Annahme. |
| **Tranche** | Ein Teil des Zahlungsplans eines Angebots mit Anteil und Auslöser; wird als Anzahlungs-, Teil- oder Schlussrechnung abgerechnet. |
| **Wartungsvertrag** | Wiederkehrende Leistung mit festem Abrechnungsrhythmus (Periodisierung), entsteht aus den wiederkehrenden Positionen eines angenommenen Angebots. |
| **Rechnung** | Unveränderliches Dokument nach österreichischem UStG mit fortlaufender Nummer; Korrektur nur per Storno. |

---

## 4. Getroffene Annahmen (vom Owner bestätigt oder als Standard gesetzt)

Diese Punkte sind Entscheidungen. Wenn du an einer Stelle triftige Gründe für eine Abweichung siehst, schreibe sie in `docs/DECISIONS.md` und frag nach, bevor du abweichst.

1. **Heute ein Nutzer, morgen SaaS**: v1 wird nur vom Owner genutzt, aber die App wird **von Anfang an mandantenfähig gebaut** (siehe §9a). Der Owner ist technisch einfach der erste Workspace. Später sollen andere Agenturen und Freelancer Aquisiteur als SaaS nutzen können, ohne Umbau des Datenmodells.
2. **Hosting**: **Eigener Server (Mikrus 3.5, Rechenzentrum in Helsinki) mit Coolify hinter Cloudflare**: Next.js als Node-Prozess (`HOSTING_PROFILE=node`), **Postgres 16** als Coolify-Ressource auf demselben Server, Dateien und Datenbank-Backups in **Cloudflare R2** (Jurisdiktion EU). Cloudflare steht vor allen Domains, weil der Server keine eigene IPv4-Adresse hat (ADR-0052). Feste Kosten, keine Kontingente, ein Server für mehrere Prototypen. Alle personenbezogenen Daten liegen in der EU. Die Cloudflare-Variante (Workers + Hyperdrive) bleibt im Code als zweites Profil erhalten; die App muss **ohne Umbau auf einen anderen Hoster umziehbar** bleiben (siehe §5a).
3. **Tracking**: Cookieless First-Party-Tracking in zwei Stufen (Owner-Entscheidung 2026-10-21, ADR-0065): Ohne Einwilligung nur die **Basis**, die auf dem Server entsteht (geöffnet, wann, QR/Kurzlink, Gerät, Stadt, was der Besucher selbst absendet). **Lesestatistik** (Abschnitte, Dauer, Scrolltiefe, Klickverhalten, Tipp-Signal, Live-Anwesenheit) und **Session-Replay** nur nach aktiver Einwilligung, je ein eigener Schalter. Keine Drittanbieter-Analytics, keine Google-Fonts-CDN, keine externen Tracker.
4. **Kontaktkanäle v1**: WhatsApp, E-Mail, Telefon/Rückruf, eigener Live-Chat. Facebook Messenger und SMS als Ausbaustufe (Architektur dafür vorbereiten).
5. **Chat**: Eigener Live-Chat im Exposé. Der Owner antwortet aus dem Cockpit (PWA, Push am Handy). Übergabe an WhatsApp jederzeit möglich.
6. **Exposé-Format**: Strukturiertes JSON gegen ein festes, versioniertes Schema mit Blockbibliothek (siehe §7.2). Claude Code erzeugt diese Dateien, die App rendert sie. Kein freies HTML.
7. **Benachrichtigungen an den Owner**: Web-Push (PWA) und E-Mail. Telegram als optionaler Kanal vorbereitet.
8. **Briefversand**: Die App erzeugt pro Prospect ein druckfertiges PDF (DIN A4, DIN-5008-konform, Fenster-Umschlag DL) mit QR-Code und Kurzlink. Der Owner druckt und versendet in v1 selbst. Der Versand ist aber von Anfang an über eine austauschbare **Versand-Schnittstelle** gebaut (siehe §7.9), damit Print-APIs wie Pingen oder LetterXpress und Handschrift-Dienste wie Pensaki später nur ein weiterer Adapter sind.
9. **Sprache**: UI und Exposés auf Deutsch, Code und Kommentare auf Englisch, i18n-fähig angelegt.
10. **Angebote und Rechnungen** (Owner-Entscheidung 2026-10-22, ADR-0067): Der Owner ist österreichischer Einzelunternehmer. Rechnungen folgen dem österreichischen UStG. Steuermodus pro Workspace, Standard **Kleinunternehmer** (§ 6 Abs. 1 Z 27 UStG, gilt in Österreich ohne Antrag ab dem ersten Umsatz), umschaltbar auf Regelbesteuerung. Rechnungsversand per E-Mail über Resend. Die Gestaltung von Angebot und Rechnung folgt später.

---

## 5. Tech-Stack

Verwende jeweils die **neueste stabile Version** und prüfe beim Setup die aktuelle Doku. Wenn eine hier genannte Lib inzwischen eine klar bessere Alternative hat, schlag sie vor.

| Bereich | Wahl | Warum |
|---|---|---|
| Framework | **Next.js (App Router)**, React Server Components, Server Actions, TypeScript strict | Ein Repo für Cockpit, öffentliche Exposés und Edge-Redirects |
| Paketmanager | pnpm | |
| Hosting | **Mikrus-Server mit Coolify** (Node, Traefik mit Cloudflare-Origin-Zertifikat), **Cloudflare** als Proxy davor; Alternative im Code: Cloudflare Workers via OpenNext | Feste, sehr niedrige Kosten, keine CPU-Grenzen pro Anfrage |
| Datenbank | **Postgres 16** auf dem Server (Coolify), Row Level Security, tägliche Dumps nach R2 | Standard-Postgres, jederzeit umziehbar |
| ORM / Migrations | **Drizzle ORM** + drizzle-kit | Typsicher, SQL-nah, schnell |
| Auth (Cockpit) | **Passkeys** (WebAuthn) + Magic Link als Fallback, via **Better Auth** (Daten in der eigenen Postgres-DB) | Kein Passwort, kein Anbieter-Lock-in |
| Validierung | **Zod** (Schemas teilen zwischen Client, Server, Exposé-Import) | |
| UI | **Tailwind CSS** (aktuelle Major), **shadcn/ui** auf Radix-Primitives, eigene Design Tokens | Zugängliche Primitives, volle Designkontrolle |
| Motion | **Motion** (ehem. Framer Motion) + native **View Transitions API**, CSS Scroll-Driven Animations | |
| Charts | Recharts oder visx, dezent | |
| Background Jobs | Stündlicher Job (`/api/jobs/hourly`) als geplante Aufgabe in Coolify, Arbeit nach Antworten per `after()`, hinter einer eigenen Job-Schnittstelle (Benachrichtigungen, Digests, Retention-Löschung, Score-Neuberechnung) | Austauschbar gegen z. B. pg-boss oder Cloudflare Cron |
| E-Mail | **Resend** + React Email | |
| Push | Web Push (VAPID), PWA mit Service Worker | Owner bekommt Push auf iOS/Android ohne App Store |
| QR | Lib, die **SVG** erzeugt (z. B. `qrcode`), Fehlerkorrektur Level M–Q, optional Logo in der Mitte | Druckqualität |
| PDF (Brief) | **React-PDF** (läuft überall, kein Chromium nötig) | DIN 5008, druckfertig |
| Dateien & Bilder | **Cloudflare R2** (EU) hinter dem `StoragePort`, alternativ ein Volume auf dem Server oder jeder andere **S3-kompatible** Speicher; Bildoptimierung (AVIF/WebP, mehrere Größen) beim Veröffentlichen per CLI mit `sharp`, nicht zur Laufzeit | Schont die Platte, per Konfiguration umstellbar |
| Session-Replay | **rrweb** (nur nach Consent), Speicherung komprimiert im Datei-Speicher | |
| Rate Limiting | Postgres-basiert hinter eigener Schnittstelle | |
| Tests | **Vitest** (Unit), **Playwright** (E2E), **axe-core** (A11y in E2E), Lighthouse CI | |
| Qualität | ESLint + Prettier (oder Biome), Typecheck in CI, GitHub Actions | |
| Monitoring | Sentry (EU-Region) | |

---

## 5a. Portabilität: jederzeit umziehen können

Der eigene Server ist das Ziel, aber kein Käfig. Wenn Last, Kosten oder Anforderungen es nötig machen, muss ein Umzug auf einen anderen Hoster (Cloudflare Workers, Vercel, ein anderer Server) **ein Konfigurationswechsel sein, kein Umbau**. Regeln:

- **Anbieterspezifischer Code nur in `src/infra/`**: Für Storage, Queue/Jobs, Cron, Cache/KV, Rate-Limit, Realtime, Domains (TLS für Kundendomains), E-Mail, Push und Briefversand gibt es je eine schmale TypeScript-Schnittstelle. Gebaut sind die Implementierungen für den Node-Server und für Cloudflare; weitere (z. B. MinIO, pg-boss) kommen erst, wenn ein Umzug ansteht. Fachcode importiert nie direkt `cloudflare:*`-Bindings oder Anbieter-SDKs; eine ESLint-Regel erzwingt das außerhalb von `src/infra/`.
- **Ein Deployment-Ziel im Betrieb**: Coolify baut aus dem Repo mit Nixpacks (`nixpacks.toml`), kein eigenes Docker-Image, keine doppelten E2E-Läufe. Der Cloudflare-Build bleibt in der CI als Größen-Check, damit der Rückweg offen bleibt.
- **Nur Standard-Postgres**: Drizzle-Migrations als einzige Quelle der Wahrheit, keine Supabase-spezifischen Features außer hinter Adaptern. Die DB muss mit `pg_dump`/`pg_restore` auf jeden Postgres-Anbieter umziehen können.
- **Auth in der eigenen DB** (Better Auth), damit Nutzerkonten beim Umzug mitkommen.
- **Dateien hinter dem `StoragePort`**: heute R2 per `STORAGE_PROVIDER=s3` (jeder S3-kompatible Speicher geht), per `STORAGE_PROVIDER=local` ein Verzeichnis auf dem Server.
- **Konfiguration nur über Env-Variablen**, dokumentiert in `.env.example`, mit Profilen `cloudflare` und `node`.
- **Lokale Entwicklung und Tests** mit `next dev` gegen ein lokales Postgres; das entspricht dem Betrieb auf dem Server. `wrangler dev` nur zum Testen der Cloudflare-Variante.
- **Limits beobachten**: Ein kleiner Bereich im Cockpit (Einstellungen → System) zeigt DB-Größe und Speicher (auf Cloudflare zusätzlich Requests und CPU-Zeit) im Verhältnis zu den Limits und warnt ab 80 %.
- `docs/DEPLOY.md` beschreibt die Einrichtung auf dem eigenen Server, `docs/DEPLOY_CLOUDFLARE.md` die Cloudflare-Variante, `docs/HOSTING.md` den Umzug.

---

## 6. Architektur

### 6.1 Oberflächen und Domains

- `app.<domain>` → **Cockpit** (geschützt, PWA, `noindex`)
- `<domain>/<code>` oder `go.<domain>/<code>` → **Kurzlink-Resolver** (Edge/Middleware, < 50 ms), loggt den Scan/Klick und leitet weiter
- `<domain>/x/<slug>` → **öffentliches Exposé** (`noindex, nofollow`, nicht in Sitemap)

Alles in **einer** Next.js-App, getrennt über Route Groups und Middleware.

### 6.2 Kurzlinks und QR-Codes

- Pro Touchpoint ein eigener Code. Zwei Formen:
  - **QR-Code** → längerer, nicht erratbarer Token (≥ 10 Zeichen, base62).
  - **Abtippbarer Kurzlink** → kurz, menschenlesbar, ohne verwechselbare Zeichen (`0/O`, `1/l/I`), z. B. `agentur.de/cafe-mueller` oder `agentur.de/k7m2`. Groß-/Kleinschreibung egal. Bei Tippfehlern: freundliche Seite mit „Meinten Sie …?“ statt 404.
- Der Resolver erfasst: Zeitpunkt, Touchpoint, grobe Geo-Info (Stadt, aus IP, IP danach verwerfen), Gerätetyp, Browser, ob QR oder getippt. Dann `302` auf das Exposé mit einem kurzlebigen, signierten Parameter, der den Visit dem Touchpoint zuordnet.
- **Bot- und Prefetch-Filter**: Link-Preview-Crawler, Sicherheits-Scanner, Messenger-Vorschauen und bekannte Bots werden erkannt und als `bot` markiert, lösen aber **keine** Benachrichtigung aus.
- **Eigene Besuche ausschließen**: Ist der Owner im Cockpit eingeloggt (oder hat er ein „Owner-Gerät“-Flag gesetzt), werden seine Aufrufe als `internal` markiert.
- QR-Export: SVG und PNG (300 dpi), wahlweise mit Rahmen und Call-to-Action („Scannen Sie für Ihre persönlichen Vorschläge“).

### 6.3 Tracking-Pipeline

- Kleines, eigenes Tracking-Script im Exposé (< 5 KB gzip), **keine Cookies, kein localStorage für Tracking-IDs**. Ohne Einwilligung sendet es nur die Basis (Besuchsstart mit dem, was die URL trägt, Teilen, Widerspruch), liest keine Gerätewerte (auch keine Fenstergröße) und hält alles Beobachtete im Speicher, nur für die Nudges. Nach „Akzeptieren“ sendet es die Lesestatistik ab diesem Moment, nie rückwirkend; der Server verwirft Lesestatistik ohne gespeicherte Einwilligung des Besuchs. Die Zuordnung zum Prospect ergibt sich aus dem Exposé selbst (es ist personalisiert). Besucher-Unterscheidung innerhalb einer Session über eine In-Memory-ID; über Sessions hinweg nur grob (Gerätetyp + Zeitfenster) oder nach Consent.
- Events werden gebündelt per `navigator.sendBeacon` / `fetch(keepalive)` an eine Route geschickt, serverseitig mit Zod validiert, rate-limitiert und in eine `events`-Tabelle geschrieben (partitioniert oder mit Index auf `(exposé_id, created_at)`).
- **Heartbeat** alle 15 s bei sichtbarem Tab (Page Visibility API) für echte Verweildauer.
- Abschnittsverweildauer über `IntersectionObserver` (Abschnitt gilt als gelesen, wenn ≥ 50 % sichtbar für ≥ 3 s).
- Aggregation (Sessions, Verweildauer, Scrolltiefe, gelesene Abschnitte) über Jobs oder Postgres-Views, nicht im Client.

### 6.4 Echtzeit

- **Realtime** hinter einer eigenen Schnittstelle (`RealtimeChannel`), auf dem eigenen Server per Server-Sent Events aus dem Node-Prozess (eine Instanz), auf Cloudflare mit Supabase Realtime, für: Live-Chat, Live-Feed im Cockpit („Jetzt gerade: Café Müller ist gerade im Exposé“). Live zeigt das Cockpit nur, **dass** jemand gerade da ist, nie welchen Abschnitt er liest, was er anklickt oder dass er tippt (Owner-Entscheidung 2026-10-21, ADR-0065); Details erscheinen erst danach in Timeline und Auswertung.

---

## 7. Funktionen

### 7.1 Prospects & Kampagnen

- CRUD für Prospects: Firma, Branche, Ansprechpartner (Anrede, Name, Rolle), Postadresse, Website, bekannte Kontaktdaten (Telefon, Mobil, E-Mail, WhatsApp, Social-Profile), Notizen, Tags.
- **Status-Pipeline** (Kanban + Liste): `Entwurf → Brief versendet → Geöffnet → Interessiert → Kontakt → Termin → Gewonnen / Verloren / Kein Interesse`. Statuswechsel teilweise automatisch (z. B. erster echter Scan → „Geöffnet“).
- Kampagnen mit Kennzahlen: versendet, geöffnet (%), Ø Verweildauer, Kontaktversuche, Abschlüsse.
- CSV-Import für Prospects.
- Globale Suche und Command Palette (⌘K) für alles.

### 7.2 Exposés: Format, Import, Rendering

**Workflow für Claude Code (wichtig, das ist der Hauptweg, wie Exposés entstehen):**

```
exposes/
  cafe-mueller/
    expose.json      # gegen schema validiert
    assets/          # Bilder, Mockups, Logos, Screenshots
```

- `pnpm expose:validate <ordner>` → prüft gegen das Zod-Schema, gibt verständliche Fehler aus.
- `pnpm expose:publish <ordner>` → lädt Assets hoch (Bilder werden zu AVIF/WebP in mehreren Größen optimiert), legt eine neue **Version** an, verknüpft mit dem Prospect. Alternativ authentifizierte REST-Route `POST /api/exposes` mit API-Token.
- Exportiere das Schema zusätzlich als **JSON Schema** (`schema/expose.schema.json`) und schreibe eine kurze Anleitung `docs/EXPOSE_AUTHORING.md` mit einem vollständigen Beispiel-Exposé, damit ein KI-Agent zuverlässig gültige Exposés erzeugen kann.
- Versionierung: Alte Versionen bleiben erhalten, Events referenzieren die Version.
- Vorschau im Cockpit (Desktop/Mobil umschaltbar), ohne Tracking.

**Blockbibliothek (Startumfang):**

| Block | Zweck |
|---|---|
| `hero` | Persönliche Begrüßung („Hallo Frau Müller …“), Kernaussage, optional Foto des Owners |
| `personal_note` | Persönlicher Text des Owners, optional kurzes Video (selbst gehostet, Untertitel Pflicht) |
| `audit` | Ist-Analyse mit Score-Kacheln (Performance, Mobil, SEO, Google-Profil …), ehrlich und belegbar |
| `before_after` | Vergleichs-Slider aktuelle Website vs. Mockup (tastaturbedienbar) |
| `findings` | Liste konkreter Probleme mit Wirkung und Lösung |
| `proposal` | Vorschläge als Karten, je mit Nutzen |
| `mockup_gallery` | Galerie mit Lightbox |
| `brand_preview` | Farben, Typo, Logo-Varianten |
| `roadmap` | Schritte / Zeitplan |
| `pricing` | Pakete oder Preisrahmen, interaktiv (Optionen an-/abwählen, Summe live) |
| `testimonials` | Referenzen |
| `faq` | Accordion |
| `about` | Über den Owner / die Agentur |
| `contact` | Kontaktbereich mit allen Kanälen (siehe 7.4) |
| `cta` | Zwischen-Call-to-Action |

- Jeder Block hat eine stabile `id`, damit Tracking pro Abschnitt funktioniert.
- **Theming pro Exposé**: Akzentfarbe und optional Logo des Prospects, damit das Exposé „für ihn gemacht“ wirkt. Kontraste werden automatisch geprüft (WCAG AA), ungenügende Farben werden angepasst. Dazu ein Gestaltungsstil (`theme.style`: `editorial` als Magazin-Standard, `bold` kantig und laut, `soft` rund und warm), der Flächenfarben, Formen, Schatten und Headline-Schrift wechselt; jeder Stil hält WCAG AA in hell und dunkel.

### 7.3 Exposé-Erlebnis (öffentlich)

- **Mobile first**: Der Einstieg kommt fast immer per QR vom Smartphone. Ziel: **LCP < 1,5 s auf 4G**, CLS ≈ 0, INP < 200 ms, Lighthouse ≥ 95 in allen Kategorien.
- Statisch vorgerendert/gecacht, nur Tracking und Chat dynamisch.
- Fortschrittsanzeige / Inhaltsnavigation, sanfte Abschnittsübergänge, respektiert `prefers-reduced-motion`.
- „Als PDF speichern“ und „Mit Kollegen teilen“ (teilen erzeugt einen eigenen Touchpoint, damit Weiterleitungen sichtbar werden).
- Gut sichtbarer, aber dezenter Link **„Kein Interesse, bitte nicht mehr kontaktieren“** → setzt Prospect auf „Kein Interesse“, sperrt Follow-ups, benachrichtigt den Owner. (Fairness und rechtliche Absicherung.)
- Datenschutzhinweis und Impressum im Footer.

### 7.4 Kontaktkanäle und Nudges

**Kanäle im Exposé** (alle mit vorbelegtem Text inkl. Referenz, z. B. „Hallo, ich habe Ihre Vorschläge für Café Müller gesehen … [Ref K7M2]“):

- **Live-Chat** (eigener, siehe 7.5)
- **WhatsApp** (`https://wa.me/<nummer>?text=…`)
- **E-Mail** (`mailto:` mit Betreff und Text)
- **Anrufen** (`tel:`) und **Rückruf anfordern** (Formular: Name, Telefon, Wunschzeit)
- **Rückruf-Formular vorausfüllen.** Sind in den Stammdaten des Kunden eine Telefon-, Handy- oder bestätigte WhatsApp-Nummer hinterlegt, bietet das Formular sie an, damit der Interessent nichts eintippen muss. Datenschutz: Der Exposé-Link kann weitergeleitet werden, deshalb erscheint die Nummer nur maskiert (z. B. „+49 170 ••• 67 verwenden?“) und wird erst nach einem Klick übernommen; die volle Nummer verlässt den Server nicht, der Rückruf geht an die gespeicherte Nummer. Pro Workspace abschaltbar.
- **Termin buchen** (optional, Einbettung z. B. Cal.com, als Block konfigurierbar)
- Vorbereitet: Facebook Messenger (`https://m.me/<page>?ref=…`), SMS (`sms:`)

Die Referenz im vorbelegten Text erlaubt dem Owner, eingehende WhatsApp-/Mail-Nachrichten eindeutig einem Prospect zuzuordnen.

**Nudges** (verhaltensbasiert, konfigurierbar, nie aufdringlich):

- Nach Lesen von ≥ 60 % des Exposés **und** ≥ 90 s Verweildauer: kleine, schließbare Einladung („Fragen dazu? Ich antworte meist innerhalb einer Stunde.“) mit Foto des Owners.
- Nach Interaktion mit `pricing`: kontextbezogene Nachricht („Soll ich Ihnen ein konkretes Angebot für diese Auswahl schicken?“).
- Bei wiederholtem Besuch: „Schön, dass Sie wieder da sind.“
- Auf Desktop bei Exit-Intent, auf Mobil nach schnellem Hochscrollen: einmaliger, leiser Hinweis.
- Sticky Kontaktleiste auf Mobil nach dem ersten Drittel.
- **Frequenzbegrenzung**: max. ein aktiver Nudge pro Session, nie modal, nie Fokus stehlen, per Tastatur schließbar, Screenreader-Ankündigung über `aria-live="polite"`.
- „Verfügbar“-Status: wenn der Owner gerade online ist (Cockpit offen oder Status gesetzt), wird das angezeigt.
- Alle Nudges sind Events (gezeigt, geschlossen, geklickt), damit ihre Wirkung messbar ist.

### 7.5 Live-Chat

- Widget im Exposé, öffnet ein Panel (kein Fullscreen-Takeover auf Desktop, Bottom Sheet auf Mobil).
- Besucher kann ohne Angabe von Daten schreiben. Nach der ersten Nachricht sanfte Frage nach Rückkanal („Wie erreiche ich Sie, falls Sie das Fenster schließen?“ → E-Mail oder Telefon/WhatsApp).
- Owner antwortet aus dem Cockpit, auch vom Handy (PWA + Push). Tipp-Indikator in beide Richtungen.
- **Übergabe**: Owner kann mit einem Klick vorschlagen, auf WhatsApp weiterzumachen.
- Offline-Modus: Wenn der Owner nicht antwortet, nach 2 min automatische Nachricht mit Erwartung und alternativen Kanälen.
- **Entwurfserkennung**: Das Widget erfasst nur, **dass** jemand angefangen hat zu schreiben (ja/nein, Zeitpunkt), auch wenn nicht gesendet wird. Nie den Inhalt, nie die Länge, und nicht live im Cockpit (Owner-Entscheidung 2026-10-21, ADR-0065). In der Datenschutzerklärung genannt.

### 7.6 Kontaktabsicht-Score (Herzstück)

Ziel: Der Owner sieht pro Prospect auf einen Blick **wie sicher** jemand Kontakt aufnehmen wollte oder hat, **warum**, und **was er jetzt tun soll**.

**Berechnung**: Jedes Signal hat eine Einzelwahrscheinlichkeit *p*. Kombination per **Noisy-OR**: `score = 1 − Π(1 − pᵢ)`. Bestätigte Kontakte setzen den Score auf 100 %. Signale verfallen nicht, aber die Anzeige zeigt, wie alt das letzte Signal ist. Gewichte zentral in einer Konfigurationsdatei, im Cockpit anpassbar.

| Signal | p (Startwert) |
|---|---|
| Echter Scan/Klick (kein Bot) | 0,05 |
| Verweildauer ≥ 2 min **oder** ≥ 75 % gelesen | 0,10 |
| Wiederholter Besuch (anderer Tag) | 0,15 |
| Exposé weitergeleitet (Share-Touchpoint genutzt) | 0,15 |
| Kontaktbereich ≥ 5 s angesehen | 0,10 |
| Hover/Fokus auf Kontakt-Button ≥ 1 s | 0,10 |
| Pricing interaktiv genutzt | 0,15 |
| Chat geöffnet | 0,20 |
| Im Chat angefangen zu schreiben, nicht gesendet | 0,50 |
| Rückruf-Formular begonnen | 0,45 |
| Telefonnummer/E-Mail des Owners kopiert (`copy`-Event) | 0,55 |
| WhatsApp-, Mail-, Messenger-, SMS- oder Tel-Link geklickt | 0,70 (App kann nicht sehen, ob gesendet wurde) |
| Termin-Buchung geöffnet | 0,50 |
| **Chat-Nachricht gesendet / Formular abgeschickt / Termin gebucht** | **1,0 (bestätigt)** |

**Stufen** (Farbe + Text + Icon, nie nur Farbe):

- 0–24 % **Neugierig**
- 25–49 % **Interessiert**
- 50–79 % **Wahrscheinlicher Kontaktversuch**
- 80–99 % **Sehr wahrscheinlicher Kontaktversuch**
- 100 % **Kontakt bestätigt**

**Erklärung & Handlungsempfehlung** (generiert aus den Signalen, kein LLM nötig):

> „**86 % – sehr wahrscheinlicher Kontaktversuch.** Heute 14:32 auf dem Smartphone den WhatsApp-Button geklickt, vorher 4 min gelesen, Preise angesehen.
> **Empfehlung:** Prüfe WhatsApp auf eine Nachricht mit *Ref K7M2*. Falls nichts da ist: Frau Müller anrufen, 0341 …, am besten vormittags.“

Die Empfehlung nennt den **Kanal, den der Prospect zuletzt angesteuert hat**, plus die **bekannten Kontaktdaten** aus dem Prospect-Profil und aus dem Chat (falls angegeben), mit Ein-Klick-Aktionen (Anrufen, WhatsApp öffnen, Mail schreiben).

### 7.7 Benachrichtigungen an den Owner

- **Regel-Engine** im Cockpit: Ereignis (erster Scan, wiederholter Besuch, Chat-Nachricht, Score überschreitet Schwelle X, „Kein Interesse“ geklickt …) → Kanal (Push, E-Mail, später Telegram) → Bedingungen (Kampagne, Ruhezeiten, nur werktags).
- Sinnvolle Standardregeln vorkonfiguriert:
  - Erster echter Scan → Push sofort
  - Chat-Nachricht → Push sofort (mit Antwortmöglichkeit aus der Notification, wenn das System es unterstützt)
  - Score ≥ 50 % → Push + E-Mail sofort
  - Tägliche Zusammenfassung 8:00 per E-Mail
- **Debounce**: Ein Besuch mit 30 Events erzeugt eine Benachrichtigung, keine 30. Updates werden in die bestehende Benachrichtigung gruppiert.
- **Ziel beim Antippen**: Jede Benachrichtigung (Push, E-Mail, Liste im Cockpit) führt direkt an die Stelle, an der das Ereignis passiert ist, nicht auf eine Übersicht:
  - Chat-Nachricht → der Chat selbst (Zusatzknopf „Zum Kunden“ → Kundenseite)
  - Rückrufwunsch → Kundenseite, Bereich „Chat und Rückrufe“
  - Erster Scan, wiederholter Besuch → Kundenseite, „Besuche im Detail“
  - Score überschreitet Schwelle → Kundenseite, „Kontaktabsicht“
  - „Kein Interesse“ → Kundenseite, „Datenschutz“
  - Tägliche Zusammenfassung → „Heute“
  - Ist die App schon offen, wechselt das offene Fenster dorthin.

### 7.8 Cockpit (Backend): Dashboards und Kundenverwaltung

Das Cockpit ist die Kommandozentrale des Owners. Hier verwaltet er alle Kunden, sieht bis ins Detail, was jeder Einzelne getan hat, und behält über Dashboards den Überblick. Es ist genauso wichtig wie das Exposé und bekommt dieselbe Designqualität.

**Dashboards**

- **„Heute“ (Startseite)**: Wer braucht jetzt eine Reaktion (sortiert nach Score und Aktualität, mit Ein-Klick-Aktionen), Live-Feed („Jetzt gerade: Café Müller ist gerade im Exposé“, ohne Abschnitte), offene Chats, fällige Follow-ups.
- **Übersichts-Dashboard**: KPI-Kacheln mit Trend gegenüber Vorperiode (versendete Briefe, Öffnungsrate, Ø Zeit bis zur Öffnung, Ø Verweildauer, Kontaktversuche, Kontaktquote, Termine, gewonnene Kunden, Umsatz-Pipeline, Kosten pro Brief und pro Abschluss). Zeitraum frei wählbar, Filter nach Kampagne, Branche, Region, Tag.
- **Funnel**: versendet → geöffnet → gelesen → Kontaktversuch → Kontakt → Termin → gewonnen, mit Absprungraten pro Stufe, vergleichbar zwischen Kampagnen.
- **Aktivitätsverlauf**: Scans und Besuche über die Zeit, Heatmap nach Wochentag × Uhrzeit (wann lesen Kunden, wann lohnt sich ein Anruf).
- **Inhalts-Dashboard**: Welche Exposé-Blöcke werden am längsten gelesen, wo springen Leser ab, welche Nudges und Kanäle funktionieren (Klickrate pro Kanal, Chat vs. WhatsApp vs. Anruf).
- **Karte**: Prospects auf einer Karte, eingefärbt nach Status/Score (nützlich für lokale Akquise).
- **Kampagnen-Dashboard** je Kampagne mit denselben Kennzahlen plus Liste aller Prospects der Kampagne.
- Alle Diagramme barrierefrei (Werte auch als Tabelle abrufbar), Export als CSV.

**Kundenverwaltung**

- **Kundenliste** als leistungsfähige Tabelle: Spalten frei wählbar, sortieren, filtern (Status, Score, Kampagne, Branche, Ort, letzte Aktivität, Tags), gespeicherte Ansichten („Heiße Leads“, „Geöffnet, aber kein Kontakt“), Mehrfachauswahl für Sammelaktionen (Status ändern, taggen, Brief erzeugen, exportieren).
- **Pipeline-Ansicht** (Kanban) mit Drag & Drop zwischen den Status.
- **Kunden-Detailseite (360°-Ansicht)**:
  - Kopf: Firma, Ansprechpartner, Status, Score-Ring mit Erklärung und Handlungsempfehlung, Ein-Klick-Aktionen (Anrufen, WhatsApp, E-Mail, Notiz, Status ändern).
  - Stammdaten und alle Kontaktdaten, bearbeitbar inline, mehrere Ansprechpartner.
  - **Timeline** aller Ereignisse in menschenlesbarer Form, filterbar: Brief versendet, gescannt, Abschnitte gelesen („*Vorher/Nachher* 48 s angesehen“), Kanäle angeklickt, Chatnachrichten, Notizen, Statuswechsel, Benachrichtigungen.
  - **Besuche im Detail**: jede Session mit Gerät, Ort (Stadt), Dauer, Scrolltiefe, gelesenen Abschnitten; Abschnitts-Heatmap auf dem Exposé; Session-Replay, wenn Einwilligung vorlag. Mehrere Besucher derselben Firma werden unterschieden.
  - Chatverlauf mit Antwortmöglichkeit, Rückrufanfragen, Entwürfe (nur Länge bzw. Inhalt, falls aktiviert).
  - Exposé-Versionen, Touchpoints mit QR-/Link-Download, Briefe mit Versandstatus.
  - Notizen (Markdown), Aufgaben/Wiedervorlagen mit Fälligkeit und Erinnerung, Tags, geschätzter Auftragswert.
  - Datenschutz-Aktionen: Export, Löschen, Sperrvermerk.
- **Aufgaben & Wiedervorlagen**: eigene Liste aller fälligen Aufgaben über alle Kunden.

**Allgemein**

- Globale Suche und Command Palette (⌘K), Tastaturkürzel für häufige Aktionen.
- **Einstellungen**: Profil (Foto, Name, Kanäle, Nummern), Benachrichtigungsregeln, Score-Gewichte, Nudge-Konfiguration, Domains, API-Tokens, Datenaufbewahrung, System-/Limit-Übersicht (§5a).
- Optimiert für Desktop **und** Handy (der Owner reagiert unterwegs); auf dem Handy stehen „Heute“, Chat und Kunden-Detail im Vordergrund.

### 7.9 Brief-Generator

- Pro Prospect ein PDF nach DIN 5008 (Form B), passend für DL-Fensterumschlag: Absender, Anschrift, Datum, Betreff, Brieftext, QR-Code mit kurzer Anleitung, abtippbarer Kurzlink, optional Unterschrift als Bild.
- Brieftext kommt aus dem Exposé-JSON (Feld `letter`) oder aus einer Vorlage mit Platzhaltern.
- Sammel-Export für eine ganze Kampagne (ein PDF, Seiten getrennt) und „als versendet markieren“ mit Datum (startet die Messung „Zeit bis zur Öffnung“).
- Follow-up-Brief (zweiter Touchpoint) mit eigenem Code.
- **Exposé-Vorschau im Brief.** Der Brief bekommt eine gestaltete zweite Seite als „Sneak Peek“ des Exposés: Headline, Vorher/Nachher als zwei Handy-Mockups (heute vs. Vorschlag), die drei wichtigsten Ideen in den Farben und der Headline-Schrift des Exposés, unten eine helle Karte „Alles Weitere auf dieser Seite“ mit Kurzlink, QR-Code und Kontakt des Owners (Foto, Telefon, E-Mail; abschaltbar). Seite 1 bleibt das DIN-5008-Anschreiben, aber mit Agenturlogo, weichen Formen, verspieltem QR-Code (in der Mitte ein Punkt in der Akzentfarbe, darin das Agenturlogo eingefärbt, falls hinterlegt) und einem dicken Pfeil, der auf die Vorschau verweist. Show, don't tell; alles aufrecht und zentriert ausgerichtet. Automatisch aus dem Exposé erzeugt, im Exposé unter `letter.teaser` überschreibbar, pro Brief abschaltbar.

- **Exposé als gestaltetes PDF.** Eine PDF-Fassung des ganzen Exposés, die über die Druckansicht des Browsers hinausgeht: Titelseite mit Headline und Inhaltsübersicht, jeder Block für Papier gesetzt, in Farben und Headline-Schrift des Exposés, am Ende Kontakt mit QR-Code und Link zurück ins Exposé. Im Cockpit pro Version herunterladbar (z. B. als Beilage zum Brief), im Exposé hinter „Als PDF speichern“ für den Leser, mit seiner Preisauswahl; die Druckansicht bleibt der Rückfall.

**Versand-Schnittstelle (Print-APIs von Anfang an mitdenken):**

- Interface `LetterDispatchProvider` mit `send(letter) → providerRef`, `getStatus(providerRef)`, `cancel(providerRef)`, `estimateCost(letter)` und einem Webhook-Handler pro Provider.
- Erster Provider in v1: `manual` (PDF herunterladen, „als versendet markieren“). Er durchläuft dieselben Zustände wie ein echter Provider.
- `letters` hat einen eigenen Lebenszyklus: `draft → queued → submitted → printed → posted → (returned | failed | cancelled)`, mit `provider`, `provider_ref`, `cost_cents`, `posted_at` und Zeitstempeln pro Zustand. „Zeit bis zur Öffnung“ rechnet immer ab `posted_at`.
- Druckoptionen modellieren: Farbe/S-W, Simplex/Duplex, Versandart (Standard, Prio), Umschlagformat, Beilagen.
- PDFs strikt nach den gängigen Print-API-Vorgaben erzeugen (Adressfeld-Position DIN 5008, Ränder für Frankierzone, eingebettete Schriften, PDF/A-tauglich). Dann funktionieren sie mit jedem Anbieter.
- **Erster echter Provider: Pingen** (Stand Oktober 2026). Pingen druckt Briefe an österreichische Empfänger lokal und lässt sie von der Österreichischen Post zustellen (Brief 2–3 Werktage, Premium Brief am nächsten Werktag). Ein Brief mit 1 Blatt S/W kostet ca. 1,43 € netto, ab 500 Briefen/Monat ca. 1,25 € netto. Die API bietet REST mit OAuth2 (Client Credentials), Webhooks für Statusänderungen, eine kostenlose Sandbox, Idempotency-Keys und ein JS-SDK. Die Pingen-Zustände werden auf den Brief-Lebenszyklus gemappt, Webhooks werden signaturgeprüft und idempotent verarbeitet. Vor dem Produktivbetrieb wird ein AV-Vertrag abgeschlossen. Umgesetzt (ADR-0063): Zugangsdaten unter Einstellungen → Briefe → Druckdienst, Testumgebung als Standard, „Per Pingen versenden“ in der Briefliste mit Bestätigung, Status per Webhook und stündlicher Abfrage. Das PDF entsteht im Browser des Owners; automatische Folgebriefe bleiben deshalb auch mit Pingen ein Entwurf, den der Owner mit einem Klick abschickt.
- Weitere mögliche Adapter: **LetterXpress** (druckt in Deutschland, nach Österreich nur als Auslandsbrief) und ein Handschrift-Dienst (z. B. **Pensaki**) für besonders wichtige Prospects.
- Automatischer Follow-up-Versand: „X Tage nach `posted_at` (Standard 14) kein Besuch → Folgebrief vorbereiten“. Die App legt einen Entwurf mit eigenem Code und eine Aufgabe „Folgebrief drucken und versenden“ an, verschickt aber nichts von selbst, auch nicht mit Pingen: Das PDF entsteht im Browser des Owners, der den Entwurf mit einem Klick an Pingen übergibt (ADR-0063). Höchstens ein automatischer Folgebrief pro erstem Brief, nie nach „Kein Interesse“, eigene Vorlage für Folgebriefe, abschaltbar in den Einstellungen.
- Zugangsdaten pro Workspace verschlüsselt (siehe §9a), Kosten pro Brief in `usage_events`.

### 7.10 Projekte, Angebote und Rechnungen

Aus einem gewonnenen Prospect wird ein **Kunde**; der Datensatz bleibt derselbe und bekommt ein Rechnungsprofil (Rechnungsadresse, Land, UID, Rechnungs-E-Mail, Zahlungsziel). Darunter liegen **Projekte**. Jedes Projekt bündelt Exposés, Angebote, Zahlungsplan, Wartungsverträge und Rechnungen. Bestehende Exposés bekommen bei der Einführung ein Projekt „Erstakquise“. Umsetzung in drei Schritten (Phase 7a–7c), Begründungen in ADR-0067.

**Angebot (7a)**

- Versioniert: Der Owner bearbeitet einen Entwurf; jedes Senden friert eine unveränderliche Version mit Prüfsumme ein. Eigener Nummernkreis (`AN-2026-0001`), vergeben beim ersten Senden. Gültigkeit (Standard 30 Tage), Texte davor und danach.
- Positionen aus einem **Leistungskatalog** in den Einstellungen (Name, Beschreibung, Einheit, Preis, Abrechnung, USt-Satz), im Angebot frei überschreibbar: Menge, Einheit, Einzelpreis in Cent, Rabatt in Prozent, USt-Satz, einmalig oder wiederkehrend (monatlich, quartalsweise, halbjährlich, jährlich), optional (vom Kunden abwählbar) oder Pflicht, Gesamtrabatt.
- **Varianten** (z. B. „Starter“, „Pro“): Positionen gelten für alle oder einzelne Varianten, der Kunde wählt online eine.
- **Zahlungsplan** mit Tranchen in Prozent oder als Betrag (die letzte Tranche nimmt den Rest), Vorlagen 100, 50/50, 30/40/30; Auslöser: bei Annahme, an einem Datum, bei einem Meilenstein, X Tage nach der vorigen Tranche. Wiederkehrende Positionen bilden den Wartungsvertrag (Beginn, Mindestlaufzeit, Kündigungsfrist, Abrechnung im Voraus oder nachträglich).
- **Öffentliche Angebotsseite** `<domain>/a/<token>` (nicht erratbar, `noindex`), im Theming des Exposés des Projekts: Positionen, Variantenwahl, optionale Positionen an/ab mit Live-Summe, Zahlungsplan, wiederkehrende Kosten, Steuerhinweis, Gültigkeit, Drucken. **Online-Annahme** mit Name, Funktion und Bestätigung „verbindlich beauftragen“; gespeichert werden Zeitpunkt, Version, Prüfsumme, Auswahl und Summen (einfache elektronische Signatur). Ablehnen mit optionalem Grund. Abgelaufene oder ersetzte Versionen lassen sich nicht mehr annehmen.
- Ansehen (erster echter Aufruf, ohne Bots und ohne Owner-Gerät) und Antwort erscheinen in der Timeline und lösen je eine Benachrichtigung aus (Ziel: das Angebot im Cockpit). Annahme setzt den Kunden auf „Gewonnen“ und das Projekt auf „Beauftragt“.
- **Exposé-Anbindung**: Der `pricing`-Block kann `"source": "offer"` tragen; beim Veröffentlichen übernimmt er die Positionen des aktuellen versendeten oder angenommenen Angebots im Projekt des Exposés (bei Varianten die empfohlene), mit dem passenden Steuerhinweis; Entwürfe werden nie von selbst öffentlich. Im Angebotseditor überträgt „Ins Exposé übernehmen“ die Preise als neue Exposé-Version.
- Später in 7a nachgereicht: `offer.json` im Exposé-Ordner legt beim Veröffentlichen einen Angebotsentwurf an; die Preisauswahl eines Besuchers im Exposé lässt sich als Angebotsanfrage abschicken (Entwurf + Aufgabe). Mehrere Exposés pro Kunde (je Projekt) über einen eigenen Exposé-Schlüssel.

**Rechnungen nach österreichischem Recht (7b)**

- Pflichtangaben nach § 11 UStG abhängig vom Betrag werden vor dem Ausstellen geprüft: bis 400 € brutto Kleinbetragsrechnung, darüber vollständige Rechnung mit UID des Leistenden, über 10.000 € brutto zusätzlich UID des Empfängers. Leistungsdatum oder -zeitraum immer.
- Steuermodus pro Workspace mit Ausnahme je Rechnung: **Kleinunternehmer** (§ 6 Abs. 1 Z 27 UStG, Standard) ohne USt-Ausweis mit Hinweistext „Der Rechnungsbetrag enthält gemäß § 6 Abs. 1 Z 27 UStG 1994 keine Umsatzsteuer.“ (änderbar), oder **regelbesteuert** mit 20/13/10/0 %. Grenzwächter für 55.000 € Jahresumsatz brutto: Warnung ab 80 %, bis 10 % Überschreitung bleibt die Befreiung bis Jahresende, darüber endet sie ab dem überschreitenden Umsatz.
- EU-Unternehmen mit UID: Übergang der Steuerschuld auf den Leistungsempfänger, beide UIDs, VIES-Prüfung, Vormerkung für die Zusammenfassende Meldung. Privatkunden in der EU und Drittland mit passendem Text; Sonderfälle werden zur Rücksprache markiert.
- Tranchen werden zu Anzahlungs- bzw. Teilrechnungen, die letzte zur Schlussrechnung, die alle vorher abgerechneten Beträge und Steuern abzieht.
- Fortlaufende, atomar vergebene Nummern pro Workspace und Jahr (`RE-2026-0001`), Entwürfe ohne Nummer. Ausgestellte Rechnungen sind unveränderlich; Korrektur nur per Storno mit eigener Nummer und Verweis plus neuer Rechnung. Aufbewahrung 7 Jahre (§ 132 BAO), auch gegenüber Datenschutz-Löschungen (dort Sperrvermerk statt Löschung).
- PDF mit EPC-QR-Code („Zahlen mit Code“) und eingebettetem ZUGFeRD/Factur-X (EN 16931). Zahlungen manuell erfassen, auch Teilzahlungen. Monatsexport CSV + PDFs als ZIP für den Steuerberater.
- Umgesetzt in 7b (ADR-0070) und 7c-1 (ADR-0071): Logo und Akzentfarbe der Agentur im PDF, ZUGFeRD/Factur-X (EN 16931, PDF/A-3b), ZIP mit PDFs und CSV je Monat, VIES-Prüfung der Kunden-UID mit ZM-Daten je Quartal. Ein Löschwunsch für einen Kunden mit ausgestellter Rechnung setzt einen Sperrvermerk: alles außer Firmenname, Projekten, Angeboten und ausgestellten Rechnungen wird gelöscht, der Rest nach Ablauf der Aufbewahrungsfrist automatisch.

**Wartung, Versand und Mahnung (7c)**

- Wartungsverträge: Intervall monatlich, quartalsweise, halbjährlich, jährlich; im Voraus oder nachträglich; anteilige erste und letzte Periode; Mindestlaufzeit, Kündigungsfrist; optional VPI-Indexierung mit Vorankündigung und Stundenkontingent. Jede Rechnung nennt den Leistungszeitraum.
- Versand per E-Mail über den E-Mail-Port (Resend, optional SMTP über das eigene Postfach) von einer eigenen Versand-Subdomain, PDF im Anhang, Link zur Rechnungsseite `<domain>/r/<token>`, Zustellstatus per Webhook, keine Öffnungs-Pixel. Drei Stufen pro Workspace und Vertrag: manuell, **Freigabe über eine Aufgabe** (Standard: der stündliche Job legt den Entwurf und eine Aufgabe „Rechnung freigeben“ an, die sich nach dem Senden selbst erledigt) und automatisch für unveränderte Wartungsrechnungen mit Rückfall auf Freigabe.
- Umgesetzt in 7c-2 (ADR-0072): Versand aus der Rechnung mit PDF im Anhang und Link zur Rechnungsseite, Versand-Log mit Message-ID, Zustellstatus per Resend-Webhook mit Aufgabe bei Unzustellbarkeit, Versandmodus und Mailtext in den Einstellungen, Freigabe-Aufgabe, die sich mit dem Versand erledigt. SMTP über das eigene Postfach folgt bei Bedarf.
- Umgesetzt in 7c-3 (ADR-0073): Wartungsverträge aus den wiederkehrenden Positionen eines angenommenen Angebots, je Kalendermonat, -quartal, -halbjahr oder -jahr, im Voraus oder nachträglich, anteiliger erster und letzter Zeitraum, Mindestlaufzeit und Kündigung zum Monatsende. Der stündliche Job legt jede fällige Rechnung an und folgt dem Versandmodus von Vertrag oder Workspace; „automatisch“ sendet nur volle Zeiträume mit denselben Positionen wie die letzte Rechnung, mit PDF vom Server (nur auf dem Node-Profil), sonst Rückfall auf die Freigabe. VPI-Indexierung und Stundenkontingent folgen als 7c-3b.
- Mahnwesen: Erinnerung 3 Tage nach Fälligkeit, Mahnungen nach 14 und 28 Tagen mit derselben Freigabe-Logik; Verzugszinsen (§ 456 UGB) und 40-€-Pauschale (§ 458 UGB) optional.
- Projekt-Dashboard: Angebotsvolumen, Annahmequote, Zeit bis zur Annahme, offene Posten, MRR, Umsatz je Kampagne.

**Später**: Gestaltung von Angebot und Rechnung, Online-Zahlung hinter einem `PaymentProvider` (Stripe oder Mollie, EPS, SEPA-Lastschrift), Bank-Abgleich (CAMT.053), Zeiterfassung, Kundenportal, BMD/DATEV-Export, PEPPOL, A/B-Tests (tief im Backlog).

Hinweis an den Owner: Die Steuerregeln sind recherchiert, ersetzen aber keine Steuerberatung; vor der ersten echten Rechnung mit dem Steuerberater abgleichen.

---

## 8. Design & UX

**Haltung**: Modern, an der Kante, aber nie verspielt auf Kosten von Klarheit. Referenzniveau: Linear, Vercel, Raycast, Arc. Das Exposé soll sich anfühlen wie ein hochwertiges, persönliches Magazin, nicht wie eine Landingpage.

- **Design Tokens** (Farben in OKLCH, Abstände, Radien, Schatten, Motion-Dauern) zentral definiert, Light & Dark Mode, `prefers-color-scheme` respektiert, manuell umschaltbar.
- **Typografie**: Eine variable Sans für UI (z. B. Inter, Geist oder ähnlich), optional eine charakterstarke Display-Schrift für Exposé-Headlines. Selbst gehostet. Fluid Type mit `clamp()`.
- **Motion** mit Sinn: View Transitions zwischen Cockpit-Seiten, scroll-getriebene Enthüllungen im Exposé, Micro-Interactions bei Buttons und Score-Änderungen. Alles abschaltbar über `prefers-reduced-motion`.
- **Cockpit**: Dichte, ruhige Oberfläche, Command Palette, Tastaturkürzel, optimistische Updates, Skeletons statt Spinner, leere Zustände mit klarer nächster Aktion.
- **Exposé**: Viel Weißraum, große Bilder, klare Hierarchie, persönliche Ansprache, sichtbares Gesicht des Owners (Vertrauen).
- **Barrierefreiheit (Pflicht, WCAG 2.2 AA)**: semantisches HTML, vollständige Tastaturbedienung, sichtbarer Fokus, Kontraste ≥ 4,5:1, Touch-Ziele ≥ 44 px, Screenreader-Labels, keine Information nur über Farbe, Untertitel für Videos, Zoom bis 200 % ohne Layoutbruch. axe-core-Tests in CI, Ziel: 0 Verstöße.

Lege zu Beginn ein kleines **Design-System** an (`/design` Route im Cockpit, nur intern) mit allen Tokens und Komponenten, bevor du Features baust.

---

## 9. Datenschutz & Recht (Deutschland)

Setze Folgendes technisch um und dokumentiere es in `docs/PRIVACY.md`. (Hinweis an den Owner: das ist keine Rechtsberatung, vor dem Livegang prüfen lassen.)

- **Rechtsgrundlage**: B2B-Briefwerbung und die Basis im personalisierten Exposé stützen sich auf berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO), Lesestatistik und Replay auf Einwilligung (lit. a). Datenschutzerklärung erklärt das transparent, inklusive Score.
- **Datenschutzhinweis im Brief** (Art. 14 DSGVO): Herkunft der Adresse (Einstellung „Herkunft der Adressen“), Hinweis auf den persönlichen Link, Widerspruchsrecht, Link auf die Datenschutzerklärung.
- **§ 25 TDDDG / § 165 Abs. 3 TKG 2021 (AT)**: Nichts auf dem Endgerät speichern oder auslesen, was nicht unbedingt erforderlich ist, ohne Einwilligung. Dazu zählt auch ein Script, das Scrollen, Abschnitte oder Eingaben beobachtet und sendet (EDSA-Leitlinien 2/2023). Deshalb ein **Einwilligungshinweis** in jedem Exposé: nicht blockierend, „Ablehnen“, „Einstellungen“, „Akzeptieren“ gleichwertig; unter „Einstellungen“ die Schalter Lesestatistik und (wenn eingeschaltet) Aufzeichnung, beide anfangs aus. Ablehnen, nichts anhaken und Ignorieren ergeben dasselbe: nur Basis. Schließen ist keine Antwort (nächster Besuch fragt erneut). Global Privacy Control gilt als Ablehnen, auf dem Owner-Gerät kein Hinweis. Im Browser nur die Entscheidung (`aq-consent`, Version + Datum, nach 180 Tagen neu fragen), auf dem Server je Zweck ein Nachweis in `consents`. „Datenschutz-Einstellungen“ im Fuß öffnet die Schalter jederzeit; Widerruf löscht Lesestatistik und Aufzeichnung des Besuchs.
- **IP-Adressen** nur zur Geo-Grobauflösung und Bot-Erkennung im Moment der Anfrage verwenden, nicht speichern (oder gekürzt).
- **Aufbewahrung**: Rohevents und Replays nach konfigurierbarer Frist automatisch löschen (Standard: 180 Tage Events, 30 Tage Replays). Prospect mit „Kein Interesse“ → personenbezogene Trackingdaten nach 30 Tagen löschen, nur Sperrvermerk behalten.
- **Betroffenenrechte**: Export und Löschung pro Prospect mit einem Klick.
- **Auftragsverarbeitung**: Nur Dienste mit EU-Hosting/AVV (Mikrus, Cloudflare, Resend, Sentry; jeweils EU-Region bzw. EU-Datenspeicherung, wo verfügbar). Liste in `docs/PRIVACY.md`.
- Impressum und Datenschutzerklärung als konfigurierbare Seiten.
- Opt-out-Link im Exposé (§ 7.3) und auf Wunsch im Brief.

---

## 9a. SaaS-Fähigkeit von Tag 1

v1 hat nur einen Nutzer, aber jede Zeile Code wird so geschrieben, als gäbe es schon hundert Workspaces. Was jetzt kaum Aufwand kostet, später aber Monate, wird **jetzt** gemacht:

- **Mandantentrennung**: Jede fachliche Tabelle hat `workspace_id` (NOT NULL, indiziert). RLS-Policies prüfen die Workspace-Mitgliedschaft, nicht „ist eingeloggt“. Ein Test stellt sicher, dass Workspace A niemals Daten von Workspace B sieht (auch über Realtime, Storage und API-Tokens).
- **Nutzer ≠ Workspace**: Tabellen `workspaces`, `users`, `memberships` (Rolle: `owner`, `admin`, `member`). Ein Nutzer kann mehreren Workspaces angehören. Berechtigungen laufen über eine zentrale `can(user, action, resource)`-Funktion, auch wenn es heute nur `owner` gibt.
- **Nichts hartkodiert**: Name, Foto, Telefonnummern, WhatsApp, Absenderadresse, Impressum, Datenschutztext, Brief-Vorlagen, Branding, Score-Gewichte und Nudge-Texte gehören zu den **Workspace-Einstellungen**, nicht in Env-Variablen oder Code.
- **Eigene Domains pro Workspace**: Exposés und Kurzlinks laufen über die Domain des jeweiligen Workspaces (z. B. `go.agentur-x.de`), mit Fallback auf eine Plattform-Subdomain (`<workspace>.aquisiteur.app`). Routing über den `Host`-Header in der Middleware. Kurzlink-Codes sind pro Domain eindeutig, nicht global. TLS über Cloudflare vor dem Server (für fremde Domains Cloudflare for SaaS; auf einem Server mit eigener IPv4 Traefik/Let's Encrypt), gekapselt in einer `DomainProvider`-Schnittstelle.
- **Storage-Pfade** immer mit Workspace-Präfix (`/{workspace_id}/exposes/...`).
- **Externe Dienste pro Workspace konfigurierbar**: Absender-Domain für E-Mails, Print-API-Zugang, Messenger-Kanäle. Secrets dieser Integrationen verschlüsselt in der DB (nicht in Env).
- **Nutzungsmessung**: Eine `usage_events`-Tabelle zählt ab Tag 1 abrechnungsrelevante Dinge (veröffentlichte Exposés, Besuche, versendete Briefe, Speicher). Darauf baut später die Abrechnung.
- **Pläne & Limits**: Eine zentrale `entitlements(workspace)`-Funktion liefert Feature-Flags und Limits. Heute gibt sie für den Owner „alles unbegrenzt“ zurück, aber jede limitierbare Funktion fragt sie bereits ab.
- **Billing-Schnittstelle vorbereitet**: Abstraktion für Abos (später Stripe Billing inkl. Steuern/Rechnungen), aber in v1 nicht implementiert.
- **Onboarding als Flow denken**: Workspace-Anlage (Name, Logo, Kanäle, Domain) als Wizard bauen, den der Owner auch selbst einmal durchläuft. Damit ist der SaaS-Einstieg später schon fertig.
- **Datenschutz als Plattform**: Später ist jeder Workspace Verantwortlicher und Aquisiteur Auftragsverarbeiter. Datenexport und Löschung deshalb auch **pro Workspace** (nicht nur pro Prospect), Audit-Log pro Workspace, Impressum/Datenschutz pro Workspace.
- **Plattform-Admin**: Eine minimale, getrennte Rolle `platform_admin` (für den Owner als Betreiber) ist im Modell vorgesehen, UI dafür erst später.
- **Exposé-CLI/API** authentifiziert per Workspace-API-Token, damit später jeder Kunde seine Exposés per Claude Code/Codex hochladen kann.

Was in v1 bewusst **nicht** gebaut wird: Einladungs-UI, Team-Verwaltung, Abrechnung, Plattform-Admin-UI, öffentliche Registrierung. Alles davon muss sich aber ohne Datenmigration ergänzen lassen.

---

## 10. Sicherheit

- Exposé-URLs und QR-Tokens nicht erratbar; Kurzlinks rate-limitiert gegen Enumeration.
- Cockpit nur mit Passkey/Magic Link, Sessions mit kurzer Laufzeit, CSRF-Schutz (Server Actions), sichere Header (CSP, HSTS, Referrer-Policy `strict-origin-when-cross-origin`).
- RLS auf allen Tabellen, Service-Role nur serverseitig.
- Event-Ingestion: Schema-Validierung, Größenlimits, Rate-Limits pro IP/Visit.
- Chat und Rückruf: Bot- und Missbrauchsschutz in Schichten (ADR-0066): Honeypot, unsichtbarer, selbst gehosteter Proof of Work (ohne Cookie, ohne Drittanbieter; kein reCAPTCHA/Turnstile, weil diese Daten an Dritte geben und eine Einwilligung bräuchten), Rate Limits pro Besuch, Client-Netz (nur als Hash), Exposé und Workspace, Inhaltsregeln (Länge, Links, Zeilen, Doppelsendung, unsichtbare Steuerzeichen entfernt), Sanitizing, keine HTML-Ausgabe von Nutzereingaben. Der Owner kann Chat und Rückruf eines Kunden im Cockpit sperren.
- Secrets nur über Env-Variablen, `.env.example` gepflegt.
- **Security-Audit vor dem Go-live** (siehe §14): unabhängige Prüfung von Anmeldung und Sitzungen, Mandantentrennung, Eingabevalidierung, Rate-Limits, Secrets, Headern/CSP, Abhängigkeiten und Datenschutz. Befunde werden nach Schweregrad in `docs/SECURITY.md` dokumentiert; kritische und hohe Befunde sind vor dem Go-live behoben, mittlere haben einen Termin oder eine begründete Ausnahme. Das Audit wird vor jedem späteren größeren Schritt (SaaS-Launch, neue öffentliche Schnittstellen) wiederholt.

---

## 11. Datenmodell (Vorschlag, verfeinern)

`workspaces`, `users`, `memberships`, `domains`, `workspace_settings`, `integrations` (verschlüsselte Secrets), `usage_events`, `prospects`, `contacts` (Personen am Prospect), `campaigns`, `exposes`, `expose_versions`, `assets`, `touchpoints` (Code, Typ, Kanal, Prospect, Version), `visits` (Touchpoint, Gerät, Geo-Stadt, Bot/Internal-Flags, Start/Ende), `events` (Visit, Typ, Block-ID, Payload JSONB, Zeit), `intent_signals`, `intent_scores` (aktueller Score + Erklärung, materialisiert), `chat_threads`, `chat_messages`, `chat_drafts`, `callback_requests`, `consents`, `notification_rules`, `notifications`, `push_subscriptions`, `letters`, `api_tokens`, `audit_log`, `tasks`; für §7.10: `projects`, `catalog_items` (Leistungskatalog), `offers` (Entwurf als JSONB, Status, Token, Annahme), `offer_versions` (eingefrorene Fassungen mit Prüfsumme), `number_series` (Nummernkreise), ab 7b `invoices`, `invoice_items`, `payments`, `dunning_steps`, `billing_documents`, ab 7c `subscriptions`.

Event-Typen als zentrale, typisierte Enum/Union (`page_view`, `heartbeat`, `section_view`, `section_dwell`, `scroll_depth`, `cta_hover`, `cta_click`, `contact_click`, `copy_contact`, `chat_open`, `chat_typing`, `chat_message_sent`, `callback_started`, `callback_submitted`, `pricing_change`, `media_play`, `nudge_shown`, `nudge_dismissed`, `nudge_clicked`, `share`, `pdf_download`, `opt_out`, `consent_given`, `consent_denied` …).

---

## 12. Nicht-Ziele für v1

- Keine KI-Generierung von Exposés in der App (macht Claude Code extern über §7.2).
- Kein Team-/Einladungs-UI, keine Abrechnung, keine öffentliche Registrierung (Architektur dafür steht aber, siehe §9a).
- Kein eigener E-Mail-Versand an Prospects zur Akquise (keine Kaltakquise per E-Mail, rechtlich heikel in DE). Angebote, Rechnungen und Mahnungen an Kunden mit Geschäftsbeziehung sind erlaubt (§7.10).
- Keine nativen Apps, PWA reicht.

---

## 13. So arbeitest du

1. **Erst planen, dann bauen.** Lies dieses Dokument, lege dann an:
   - `CLAUDE.md` (Projektkonventionen, Befehle, Architekturüberblick für künftige Sessions)
   - `docs/ARCHITECTURE.md` (Diagramm der Komponenten und Datenflüsse)
   - `docs/DECISIONS.md` (kurze ADRs zu jeder relevanten Entscheidung)
   - `docs/ROADMAP.md` (die Phasen unten als Checkliste)
   Stelle mir danach **gebündelt** deine offenen Fragen, jeweils mit deiner Empfehlung. Bei Kleinigkeiten entscheide selbst und dokumentiere es.
2. **In Phasen liefern.** Jede Phase endet mit: lauffähig, Tests grün, Lint/Typecheck grün, kurzer Demo-Anleitung, Commit(s) mit klaren Messages. Keine halbfertigen Phasen.
3. **Seed-Daten**: Lege ein realistisches Beispiel-Prospect mit vollständigem Beispiel-Exposé an, damit jede Phase sofort sichtbar ist.
4. **Tests**: Unit-Tests für Score-Berechnung, Bot-Filter, Kurzlink-Normalisierung, Schema-Validierung. E2E-Test für den Kernpfad: QR-Link öffnen → Exposé lesen → Chat tippen → Owner sieht Score und Benachrichtigung.
5. **Keine Abkürzungen** bei Barrierefreiheit, Datenschutz und Sicherheit, auch nicht „erstmal“.
6. Wenn etwas in diesem Dokument widersprüchlich oder technisch unklug ist: sag es.

### Phasen

| Phase | Inhalt | Fertig, wenn … |
|---|---|---|
| **0 – Fundament** | Repo-Setup, CI, `src/infra/`-Schnittstellen mit Lint-Regel, Design Tokens, Design-System-Seite, Auth (Passkey), mandantenfähiges DB-Schema (Workspaces, Memberships, RLS) + Migrations, Host-basiertes Routing, Onboarding-Wizard, Seed | Owner legt per Wizard seinen Workspace an, sieht leeres Cockpit, Isolationstest zwischen zwei Workspaces grün, CI grün |
| **1 – Exposé-Hosting** | Schema + JSON Schema, CLI `validate/publish`, Blockbibliothek, öffentliches Rendering, Theming, Vorschau, `EXPOSE_AUTHORING.md` | Beispiel-Exposé per CLI veröffentlicht, Lighthouse ≥ 95, axe 0 Verstöße |
| **2 – Links & Tracking** | Kundenliste mit Filtern und gespeicherten Ansichten, Pipeline, Kunden-Detailseite, Touchpoints, Kurzlinks, QR-Export, Resolver, Bot-/Internal-Filter, Tracking-Script, Event-Ingestion, Timeline | Scan erscheint in der Timeline, Bots werden ignoriert |
| **3 – Kontakt & Chat** | Kontaktblock mit allen v1-Kanälen, Live-Chat (beide Seiten, Realtime), Rückruf, Entwurfserkennung, Nudges | Chat funktioniert Handy ↔ Cockpit in Echtzeit |
| **4 – Intent & Benachrichtigung** | Score-Engine, Erklärung + Empfehlung, Regel-Engine, Push + E-Mail, Digest, „Heute“-Ansicht | E2E-Kernpfad grün, Push kommt auf dem Handy an |
| **5 – Brief & Auswertung** | Übersichts-, Kampagnen- und Inhalts-Dashboards, Karte, Brief-PDF, Sammel-Export, Versand-Schnittstelle mit `manual`-Provider und Brief-Lebenszyklus, Kampagnen-Funnel, Abschnitts-Heatmap, Consent + Session-Replay | Kampagne komplett von Import bis Auswertung durchspielbar |
| **6 – Härtung** | Retention-Jobs, Datenexport/-löschung, Security-Header, Rate-Limits, Monitoring, Datenschutzseiten | `docs/PRIVACY.md` vollständig, Security-Checkliste abgehakt |
| **7 – Projekte, Angebote, Rechnungen** | 7a Projekte, Leistungskatalog, Angebotseditor, öffentliche Angebotsseite mit Online-Annahme, Exposé-Anbindung · 7b Rechnungen nach AT-Recht, Steuermodus, Nummernkreise, Teil-/Schlussrechnung, Storno, PDF mit EPC-QR und ZUGFeRD, Zahlungen, Export · 7c Wartungsverträge, Versand mit Freigabe über Aufgaben, Mahnwesen, Projekt-Dashboard (§7.10) | Angebot online angenommen, daraus Teil-, Schluss- und Wartungsrechnung nach Freigabe per Mail versendet, Kleinunternehmer- und USt-Modus getestet |
| **Später** | Weitere Print-API-Adapter (LetterXpress, ein Handschrift-Dienst; Pingen und automatische Folgebriefe sind umgesetzt), Messenger, SMS, Telegram, A/B-Varianten von Exposés, KI-Assistent für Exposé-Entwürfe, **SaaS-Launch** (Registrierung, Teams, Stripe-Abrechnung, Plattform-Admin, Landingpage) | – |

---

## 14. Definition of Done (gesamt)

- Ein Brief mit QR-Code führt in < 1,5 s zu einem schönen, persönlichen, barrierefreien Exposé.
- Jede relevante Interaktion ist in der Timeline lesbar, Bots und eigene Besuche verfälschen nichts.
- Der Owner bekommt im richtigen Moment genau eine sinnvolle Benachrichtigung und sieht sofort: **wer, wie sicher, über welchen Kanal, was jetzt tun.**
- Ein neues Exposé kann von Claude Code in einem Schritt validiert und veröffentlicht werden.
- Alles datenschutzkonform dokumentiert, getestet, deploybar.
- **Vor dem Go-live:** Der stündliche Job (`/api/jobs/hourly`: Folgebriefe, Aufgaben-Erinnerungen, Digests, Retention, Replay-Löschung, Geocoding) läuft per Cron, und die Datenbank wird täglich gesichert, **extern in Cloudflare R2** (EU) und nicht nur auf demselben Server, weil ein lokales Backup bei Verlust des Servers mit verloren geht. Gilt für jede Betriebsvariante, auch Docker Compose (ADR-0054). Auf dem Mikrus-Testserver für die Entwicklung bewusst weggelassen.
- **Vor dem Go-live:** Ein Security-Audit (§10) ist durchgeführt, kritische und hohe Befunde sind behoben und mit Tests abgesichert, das Ergebnis steht in `docs/SECURITY.md`. Kurz vor dem Go-live zusätzlich ein Blick von außen auf die laufende Produktion (Header, TLS, offene Ports, erreichbare Admin- und Debug-Routen).
- **Vor dem Go-live:** Staging und Produktion sind getrennt. Staging bekommt jeden Merge auf `main` automatisch, Produktion bekommt nur Versionen, die der Owner freigibt (Release-Tag oder manueller Start, ADR-0057). Jede Umgebung hat eigene Datenbank, eigene Dateien und eigene Subdomains. Ob beide auf einem Server laufen oder auf zwei (sicherer, etwa zwei Mikrus 3.5), entscheidet der Owner beim Go-live; der Workflow unterstützt beides.
