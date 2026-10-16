# Exposés schreiben und veröffentlichen

Ein Exposé ist ein Ordner mit einer `expose.json` und den Dateien, die sie verwendet. Du (oder Claude
Code) schreibst ihn lokal, prüfst ihn mit `pnpm expose:validate` und veröffentlichst ihn mit
`pnpm expose:publish`. Danach liegt er unter `https://<workspace>.<plattform-domain>/x/<slug>` bzw. unter
deiner eigenen Domain.

Vollständige Beispiele: [`exposes/cafe-mueller`](../exposes/cafe-mueller/expose.json) (alle
Bausteine außer Marke und Stimmen) und [`exposes/tischlerei-holzmann`](../exposes/tischlerei-holzmann/expose.json),
beide im Stil `editorial`. Andere Stile zeigen [`exposes/eisenwerk-athletics`](../exposes/eisenwerk-athletics/expose.json)
(`bold`, dunkel) und [`exposes/physio-lindenhof`](../exposes/physio-lindenhof/expose.json) (`soft`, hell).
Wähle den Stil nach der Branche: `bold` für laute Marken (Fitness, Barbershop, Streetfood), `soft` für
Vertrauensberufe (Praxis, Pflege, Kita), `editorial` für alles Handwerkliche und Gastronomie.
Das maschinenlesbare Schema liegt in [`schema/expose.schema.json`](../schema/expose.schema.json); Editoren
wie VS Code ergänzen damit Felder automatisch, wenn die Datei mit `"$schema": "../../schema/expose.schema.json"`
beginnt.

## Ordner

```
exposes/baeckerei-korn/
  expose.json
  assets/
    logo.svg
    vorher.png
    nachher.png
    video.mp4        # optional, mit video.vtt (Untertitel sind Pflicht)
```

Dateien werden immer als `assets/<name>` referenziert. Erlaubt sind Bilder (`png`, `jpg`, `webp`,
`avif`, `svg`), Videos (`mp4`, `webm`, höchstens 30 MB) und Untertitel (`vtt`). Bilder rechnet die CLI vor
dem Hochladen in AVIF und WebP mit 480, 960 und 1600 px Breite um; SVGs werden dabei gerastert, damit
keine Skripte aus Fremddateien ausgeliefert werden. Lade Bilder also in guter Qualität hoch (mindestens
1600 px breit für Bilder über die volle Breite), die CLI kümmert sich um die Dateigröße.

## Aufbau der `expose.json`

```jsonc
{
  "$schema": "../../schema/expose.schema.json",
  "schemaVersion": 1,
  "prospect": {
    "key": "baeckerei-korn", // stabil: gleicher Key = gleicher Kunde, neue Version
    "company": "Bäckerei Korn",
    "contact": {
      "salutation": "Frau",
      "firstName": "Anna",
      "lastName": "Korn",
      "role": "Inhaberin",
    },
    "address": {
      "street": "Hauptstraße 1",
      "postalCode": "04109",
      "city": "Leipzig",
      "country": "DE",
    },
    "website": "https://baeckerei-korn.example",
    "phone": "+49 341 123456",
    "email": "info@baeckerei-korn.example",
  },
  "meta": {
    "title": "Ideen für die Bäckerei Korn", // Browser-Tab und Link-Vorschau
    "description": "Wie mehr Kunden Ihre Öffnungszeiten finden.",
  },
  "theme": {
    "accent": "#b45309", // wird für hell und dunkel auf WCAG AA korrigiert
    "logo": { "src": "assets/logo.svg", "alt": "Bäckerei Korn" },
    "appearance": "auto", // auto | light | dark
    "style": "editorial", // editorial (Magazin, Serifen) | bold (kantig, schwer, harte Schatten) | soft (rund, warm, freundlich)
  },
  "letter": {
    // optional, für den Brief (Phase 3)
    "subject": "Drei Ideen für Ihre Website",
    "body": "Sehr geehrte Frau Korn, …",
  },
  "blocks": [/* 1 bis 40 Bausteine, siehe unten */],
}
```

Pflicht sind `schemaVersion`, `prospect` (mit `key` und `company`), `meta.title` und `blocks`.
`prospect.key` besteht aus 3–60 Kleinbuchstaben, Ziffern und Bindestrichen.

### Texte

Lange Texte (`body`, `lead`, `answer`, …) verstehen ein kleines Markdown:

- Leerzeile = neuer Absatz, Zeilenumbruch = neue Zeile
- `**fett**`, `*kursiv*`
- `[Linktext](https://…)`, auch `mailto:` und `tel:`
- Zeilen, die mit `- ` beginnen, werden eine Liste

HTML wird nie ausgeführt, sondern als Text angezeigt.

### Bilder

Jedes Bild ist ein Objekt `{ "src": "assets/…", "alt": "…", "caption": "…" }`. `alt` beschreibt, was
man sieht („Entwurf der Startseite mit großem Foto der Kuchentheke“), nicht „Bild“. Ein leerer
`alt`-Text (`""`) ist nur für rein dekorative Bilder erlaubt; die CLI warnt dann.

## Bausteine

Jeder Baustein hat eine `id` (Kleinbuchstaben und Bindestriche, eindeutig im Exposé, wird zum Anker
`#id`) und einen `type`. Mit `*` markierte Felder sind Pflicht.

| `type`           | Felder                                                                                                                                                              | Wofür                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `hero`           | `greeting*`, `headline*`, `eyebrow`, `lead`, `image`, `showOwnerPhoto`                                                                                              | Persönlicher Einstieg. Höchstens einer pro Exposé.                   |
| `personal_note`  | `body*`, `title`, `showSignature`, `video` (`src*`, `captions*`, `title*`, `poster`)                                                                                | Warum Sie schreiben, mit Unterschrift und optional Video.            |
| `audit`          | `title*`, `scores*` (`label*`, `value*` 0–100, `source*`, `detail`), `intro`                                                                                        | Messwerte zur heutigen Website. Jede Zahl braucht eine Quelle.       |
| `before_after`   | `title*`, `before*`, `after*`, `beforeLabel`, `afterLabel`, `intro`                                                                                                 | Schieberegler, per Tastatur bedienbar. Beide Bilder gleiches Format. |
| `findings`       | `title*`, `items*` (`title*`, `impact*`, `solution*`, `severity`: high/medium/low), `intro`                                                                         | Probleme mit Folgen und Lösung.                                      |
| `proposal`       | `title*`, `items*` (`title*`, `description*`, `benefit*`, `icon`), `intro`                                                                                          | Ihre Vorschläge.                                                     |
| `mockup_gallery` | `title*`, `images*`, `intro`                                                                                                                                        | Entwürfe, mit Großansicht.                                           |
| `brand_preview`  | `title*`, `colors` (`name*`, `value*`, `usage`), `typography` (`role*`, `family*`, `sample*`, `style`: sans/serif/mono), `logos`, `intro`                           | Farben, Schriften, Logo-Varianten.                                   |
| `roadmap`        | `title*`, `steps*` (`title*`, `description*`, `duration`), `intro`                                                                                                  | Ablauf in Schritten.                                                 |
| `pricing`        | `title*`, `options*` (`id*`, `title*`, `price*`, `priceTo`, `billing`: once/monthly, `selected`, `required`, `description`), `intro`, `note`, `currency`, `vatNote` | Preisrahmen mit wählbaren Optionen und Live-Summe.                   |
| `testimonials`   | `title*`, `items*` (`quote*`, `author*`, `role`, `company`, `photo`)                                                                                                | Stimmen anderer Kunden. Nur echte Zitate mit Zustimmung.             |
| `faq`            | `title*`, `items*` (`question*`, `answer*`)                                                                                                                         | Häufige Fragen, aufklappbar.                                         |
| `about`          | `title*`, `body*`, `image`, `facts` (`label*`, `value*`)                                                                                                            | Über Sie bzw. Ihre Agentur.                                          |
| `contact`        | `title*`, `channels` (chat, whatsapp, phone, callback, email, booking, messenger, sms; Reihenfolge zählt), `message`, `intro`                                       | Kontaktwege. Nummern kommen aus den Einstellungen.                   |
| `cta`            | `headline*`, `label*`, `target*` (id eines anderen Bausteins), `text`                                                                                               | Hervorgehobener Sprung, z. B. zum Kontakt.                           |

Icons für `proposal`: `website`, `mobile`, `search`, `map`, `social`, `brand`, `photo`, `speed`,
`calendar`, `shop`, `mail`, `chart`.

Name, Foto, Telefonnummern und WhatsApp kommen aus **Einstellungen → Profil und Kanäle**, nicht aus dem
Exposé. Bei WhatsApp und E-Mail hängt das Exposé automatisch `[Ref XXXX]` an die vorausgefüllte
Nachricht, damit Sie Antworten zuordnen können.

Ohne `channels` zeigt der Block Chat, WhatsApp, Telefon, Rückruf, E-Mail und Termin, soweit in den
Einstellungen hinterlegt. Messenger und SMS erscheinen nur, wenn Sie sie ausdrücklich aufführen. Chat,
Abwesenheitsnotiz und Nudges stellen Sie unter **Einstellungen → Kontakt und Chat** ein.

## Prüfen und veröffentlichen

```bash
pnpm expose:validate exposes/baeckerei-korn
```

Prüft Schema, Dateien, Bildmaße und Alt-Texte, ohne etwas hochzuladen. Fehler zeigen den genauen Pfad,
z. B. `blocks[3] (findings "probleme").items[0].title: Pflichtfeld fehlt`.

Zum Veröffentlichen brauchst du einen API-Token (**Einstellungen → API-Tokens**, wird nur einmal
angezeigt):

```bash
export AQUISITEUR_API_TOKEN=aq_…
export AQUISITEUR_API_URL=https://app.aquisiteur.de   # lokal: http://localhost:3000
pnpm expose:publish exposes/baeckerei-korn
```

Die CLI lädt nur Dateien hoch, die der Server noch nicht hat, und gibt am Ende den öffentlichen Link,
den Kurzlink und den QR-Link für den Brief sowie den Cockpit-Link aus. Der Kurzlink (z. B.
`pixelwerk.de/k7m2`) ist zum Abtippen gedacht, der QR-Link gehört in den QR-Code. Jeder Publish mit demselben `prospect.key` erzeugt eine neue Version unter
demselben Link; alte Versionen bleiben im Cockpit sichtbar. Prospect-Daten, die du im Cockpit geändert
hast, überschreibt ein erneuter Publish nicht.

## REST-API

Die CLI nutzt dieselbe API, die auch andere Werkzeuge verwenden können. Alle Aufrufe brauchen
`Authorization: Bearer aq_…`.

| Aufruf                       | Inhalt                                                                                                               | Antwort                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `POST /api/v1/assets/lookup` | `{ "sha256": ["…"] }`                                                                                                | welche Dateien schon vorhanden sind                                |
| `POST /api/v1/assets`        | Multipart: `meta` (JSON mit `path`, `sha256`, `width`, `height`, `variants[]`) und je Variante ein Teil `p0`, `p1` … | `201` neu, `200` schon vorhanden                                   |
| `POST /api/v1/exposes`       | `{ "document": { …expose.json… }, "assets": [{ "path": "assets/…", "sha256": "…" }] }`                               | `{ exposeId, version, refCode, url, previewUrl, shortUrl, qrUrl }` |

Validierungsfehler kommen als `400` mit `issues: [{ path, message }]`.

## Im Cockpit

Unter **Kunden** finden Sie alle Prospects mit Filtern, gespeicherten Ansichten, Pipeline und CSV-Export.
Die Kundenseite zeigt die Timeline (Scans, gelesene Abschnitte, Klicks, Statuswechsel), alle Besuche im
Detail und die Links mit QR-Codes zum Herunterladen.

Unter **Exposés** siehst du alle veröffentlichten Exposés mit Version und Status. Die Detailseite zeigt
eine Vorschau (Mobil/Desktop), alle Versionen und den Schalter **Offline nehmen**. Offline genommene
Exposés antworten mit 404, bis du sie wieder online stellst oder neu veröffentlichst.

## Was Interessenten sehen

- Kein Cookie-Banner nötig: Exposés setzen keine Cookies. Ein kleines eigenes Script misst ohne Cookies,
  welche Abschnitte gelesen und welche Kontaktwege angeklickt werden; das sehen Sie unter **Kunden** in
  der Timeline.
- Fußzeile mit Impressum und Datenschutz aus deinen Einstellungen und dem Link „Kein Interesse, bitte
  nicht mehr kontaktieren“. Ein Klick darauf (mit Bestätigung) markiert den Prospect als „kein
  Interesse“; spätere Erinnerungen an ihn werden gesperrt.
- Exposés sind `noindex`; Suchmaschinen nehmen sie nicht auf.
