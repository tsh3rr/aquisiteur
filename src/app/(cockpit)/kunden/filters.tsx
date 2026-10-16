import { Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import {
  COLUMN_LABELS,
  COLUMNS,
  DEFAULT_COLUMNS,
  type ListQuery,
} from "@/domain/prospects/list-query";
import { PROSPECT_STATUSES, STATUS_LABELS } from "@/domain/prospects/status";

const checkbox =
  "size-5 rounded border-border-strong accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** Plain GET form: filters live in the URL and work without JavaScript. */
export function CustomerFilters({ query, tags }: { query: ListQuery; tags: string[] }) {
  const moreActive = query.statuses.length > 0 || query.columns.join() !== DEFAULT_COLUMNS.join();
  return (
    <form
      method="get"
      action="/kunden"
      className="grid gap-4"
      role="search"
      aria-label="Kunden filtern"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end">
        <Field label="Suche">
          <Input
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder="Firma, Ort oder E-Mail"
            autoComplete="off"
          />
        </Field>
        <Field label="Letzte Aktivität">
          <Select name="aktiv" defaultValue={query.activity ?? ""}>
            <option value="">Egal</option>
            <option value="24h">Letzte 24 Stunden</option>
            <option value="7d">Letzte 7 Tage</option>
            <option value="30d">Letzte 30 Tage</option>
            <option value="never">Noch nie geöffnet</option>
          </Select>
        </Field>
        <Field label="Tag">
          <Select name="tag" defaultValue={query.tag ?? ""}>
            <option value="">Alle</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sortieren nach">
          <Select name="sort" defaultValue={`${query.sort}`}>
            <option value="activity">Letzter Aktivität</option>
            <option value="score">Kontaktabsicht</option>
            <option value="company">Firma</option>
            <option value="status">Status</option>
            <option value="city">Ort</option>
            <option value="created">Angelegt</option>
          </Select>
        </Field>
        <Button type="submit">
          <Search aria-hidden />
          Anwenden
        </Button>
      </div>
      <details open={moreActive} className="group rounded-lg border border-border bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-medium">
          <SlidersHorizontal aria-hidden className="size-4" />
          Status, Reihenfolge und Spalten
          {query.statuses.length > 0 ? (
            <span className="text-foreground-muted">({query.statuses.length} Status gewählt)</span>
          ) : null}
        </summary>
        <div className="grid gap-6 border-t border-border p-4 md:grid-cols-[2fr_1fr_1fr]">
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Status</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              {PROSPECT_STATUSES.map((status) => (
                <label key={status} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="status"
                    value={status}
                    defaultChecked={query.statuses.includes(status)}
                    className={checkbox}
                  />
                  {STATUS_LABELS[status]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="grid content-start gap-1">
            <legend className="mb-2 text-sm font-medium">Reihenfolge</legend>
            {(
              [
                ["desc", "Absteigend"],
                ["asc", "Aufsteigend"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="dir"
                  value={value}
                  defaultChecked={query.dir === value}
                  className={checkbox}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="grid content-start gap-1">
            <legend className="mb-2 text-sm font-medium">Spalten</legend>
            {COLUMNS.map((column) => (
              <label key={column} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="spalten"
                  value={column}
                  defaultChecked={query.columns.includes(column)}
                  className={checkbox}
                />
                {COLUMN_LABELS[column]}
              </label>
            ))}
          </fieldset>
        </div>
      </details>
      {query.q || query.activity || query.tag || query.statuses.length > 0 ? (
        <p className="text-sm">
          <Link href="/kunden" className="text-accent underline underline-offset-4">
            Alle Filter zurücksetzen
          </Link>
        </p>
      ) : null}
    </form>
  );
}
