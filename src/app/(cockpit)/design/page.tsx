import { Bell, Plus } from "lucide-react";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Kbd, PageHeader, Skeleton } from "@/components/ui/misc";
import { contrastPairs, dark, fontSize, light, radius, type ColorScheme } from "@/design/tokens";
import { contrastRatio, formatOklch } from "@/lib/color";
import { requireCockpit } from "@/server/session";

export const metadata: Metadata = { title: "Design-System" };

const kebab = (value: string) => value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

/** Internal reference of all tokens and components (§8). */
export default async function DesignSystemPage() {
  await requireCockpit();
  const colorNames = Object.keys(light) as (keyof ColorScheme)[];

  return (
    <div className="grid gap-10">
      <PageHeader
        title="Design-System"
        description="Tokens und Komponenten des Cockpits. Quelle: src/design/tokens.ts."
      />

      <section aria-labelledby="colors" className="grid gap-4">
        <h2 id="colors" className="text-xl font-semibold">
          Farben
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {colorNames.map((name) => (
            <li key={name} className="overflow-hidden rounded-md border border-border bg-surface">
              <div className="h-14" style={{ background: `var(--aq-${kebab(name)})` }} />
              <div className="grid gap-0.5 p-2.5">
                <span className="text-sm font-medium">{name}</span>
                <span className="font-mono text-xs text-foreground-muted">
                  {formatOklch(light[name])}
                </span>
                <span className="font-mono text-xs text-foreground-muted">
                  {formatOklch(dark[name])}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="contrast" className="grid gap-4">
        <h2 id="contrast" className="text-xl font-semibold">
          Kontraste (WCAG 2.2 AA)
        </h2>
        <div className="relative overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Kontrastverhältnisse aller verwendeten Farbpaare</caption>
            <thead className="bg-surface-sunken">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Vordergrund / Hintergrund
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Mindestens
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Hell
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Dunkel
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contrastPairs.map(({ fg, bg, min }) => (
                <tr key={`${fg}-${bg}`}>
                  <th scope="row" className="px-3 py-2 font-normal">
                    {fg} / {bg}
                  </th>
                  <td className="px-3 py-2 tabular-nums">{min}:1</td>
                  <td className="px-3 py-2 tabular-nums">
                    {contrastRatio(light[fg], light[bg]).toFixed(2)}:1
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {contrastRatio(dark[fg], dark[bg]).toFixed(2)}:1
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="type" className="grid gap-4">
        <h2 id="type" className="text-xl font-semibold">
          Typografie
        </h2>
        <Card>
          <CardContent className="grid gap-3">
            {(Object.keys(fontSize) as (keyof typeof fontSize)[])
              .slice()
              .reverse()
              .map((size) => (
                <p
                  key={size}
                  style={{ fontSize: `var(--aq-text-${size})` }}
                  className="leading-tight"
                >
                  <span className="mr-3 inline-block w-10 font-mono text-xs text-foreground-muted">
                    {size}
                  </span>
                  Persönliche Vorschläge für Café Müller
                </p>
              ))}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="radius" className="grid gap-4">
        <h2 id="radius" className="text-xl font-semibold">
          Radien und Schatten
        </h2>
        <div className="flex flex-wrap gap-4">
          {(Object.keys(radius) as (keyof typeof radius)[]).map((name) => (
            <div
              key={name}
              className="grid size-24 place-items-center border border-border bg-surface text-sm shadow-md"
              style={{ borderRadius: `var(--aq-radius-${name})` }}
            >
              {name}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="components" className="grid gap-4">
        <h2 id="components" className="text-xl font-semibold">
          Komponenten
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Buttons</CardTitle>
              <CardDescription>
                Alle Größen halten auf Touch-Geräten mindestens 44 px.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button>
                <Plus aria-hidden />
                Primär
              </Button>
              <Button variant="secondary">Sekundär</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Löschen</Button>
              <Button variant="link">Link</Button>
              <Button size="sm" variant="secondary">
                Klein
              </Button>
              <Button disabled>Deaktiviert</Button>
              <Button size="icon" variant="secondary" title="Benachrichtigungen">
                <Bell aria-hidden />
                <span className="sr-only">Benachrichtigungen</span>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Formular</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Firma" hint="So, wie sie im Brief erscheint.">
                <Input placeholder="Café Müller" />
              </Field>
              <Field label="E-Mail" error="Bitte eine gültige E-Mail-Adresse angeben.">
                <Input type="email" defaultValue="mueller@" />
              </Field>
              <Field label="Notiz" optional>
                <Textarea placeholder="Website von 2014, kein SSL …" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Farbe nie allein: immer mit Text und Icon.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge>Entwurf</Badge>
                <Badge tone="accent">Geöffnet</Badge>
                <Badge tone="success">Gewonnen</Badge>
                <Badge tone="warning">Wiedervorlage</Badge>
                <Badge tone="danger">Kein Interesse</Badge>
              </div>
              <Alert>Neue Funktionen erscheinen phasenweise.</Alert>
              <Alert tone="success">Exposé veröffentlicht.</Alert>
              <Alert tone="warning">Domain wartet auf DNS-Eintrag.</Alert>
              <Alert tone="danger">Veröffentlichung fehlgeschlagen.</Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Laden und Tastatur</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2" aria-hidden>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-20" />
              </div>
              <p className="text-sm text-foreground-muted">
                Befehlspalette: <Kbd>⌘</Kbd> <Kbd>K</Kbd>
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
