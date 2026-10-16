import { isProspectStatus, type ProspectStatus } from "./status";

/**
 * Filters, sorting and columns of the customer list (§7.8), kept in the URL
 * so a view can be bookmarked, shared and saved („gespeicherte Ansichten“).
 */
export const ACTIVITY_FILTERS = ["24h", "7d", "30d", "never"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export const SORT_KEYS = ["activity", "score", "company", "status", "city", "created"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const COLUMNS = [
  "status",
  "score",
  "campaign",
  "city",
  "activity",
  "visits",
  "tags",
  "created",
] as const;
export type Column = (typeof COLUMNS)[number];
export const DEFAULT_COLUMNS: Column[] = ["status", "score", "city", "activity", "visits", "tags"];

export const COLUMN_LABELS: Record<Column, string> = {
  status: "Status",
  score: "Kontaktabsicht",
  campaign: "Kampagne",
  city: "Ort",
  activity: "Letzte Aktivität",
  visits: "Besuche",
  tags: "Tags",
  created: "Angelegt",
};

export interface ListQuery {
  q: string;
  statuses: ProspectStatus[];
  activity: ActivityFilter | null;
  tag: string | null;
  /** A campaign id, "none" for prospects without campaign, or null for all. */
  campaign: string | null;
  sort: SortKey;
  dir: "asc" | "desc";
  columns: Column[];
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function all(params: Params, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value = params[key];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

const one = (params: Params, key: string) => all(params, key)[0];

export function parseListQuery(params: Params): ListQuery {
  const statuses = all(params, "status")
    .flatMap((value) => value.split(","))
    .filter(isProspectStatus);
  const activity = one(params, "aktiv");
  const sort = one(params, "sort");
  const columns = all(params, "spalten")
    .flatMap((value) => value.split(","))
    .filter((c): c is Column => (COLUMNS as readonly string[]).includes(c));
  const tag = one(params, "tag")?.trim().slice(0, 40);
  const campaign = one(params, "kampagne");
  return {
    q: (one(params, "q") ?? "").trim().slice(0, 100),
    statuses: [...new Set(statuses)],
    activity: (ACTIVITY_FILTERS as readonly string[]).includes(activity ?? "")
      ? (activity as ActivityFilter)
      : null,
    tag: tag || null,
    campaign:
      campaign === "none" || /^[0-9a-f-]{36}$/i.test(campaign ?? "")
        ? campaign!.toLowerCase()
        : null,
    sort: (SORT_KEYS as readonly string[]).includes(sort ?? "") ? (sort as SortKey) : "activity",
    dir: one(params, "dir") === "asc" ? "asc" : "desc",
    columns: columns.length > 0 ? COLUMNS.filter((c) => columns.includes(c)) : DEFAULT_COLUMNS,
  };
}

/** Canonical query string (defaults left out), e.g. "status=opened&aktiv=7d". */
export function serializeListQuery(query: Partial<ListQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.statuses?.length) params.set("status", query.statuses.join(","));
  if (query.activity) params.set("aktiv", query.activity);
  if (query.tag) params.set("tag", query.tag);
  if (query.campaign) params.set("kampagne", query.campaign);
  if (query.sort && query.sort !== "activity") params.set("sort", query.sort);
  if (query.dir === "asc") params.set("dir", "asc");
  if (query.columns && query.columns.join(",") !== DEFAULT_COLUMNS.join(",")) {
    params.set("spalten", query.columns.join(","));
  }
  // Commas are safe in a query string and keep shared links readable.
  return params.toString().replace(/%2C/g, ",");
}

/** Built-in views; a workspace adds its own on top. */
export const BUILT_IN_VIEWS: { name: string; query: string }[] = [
  { name: "Alle", query: "" },
  { name: "Geöffnet, aber kein Kontakt", query: "status=opened,interested" },
  { name: "Diese Woche aktiv", query: "aktiv=7d" },
  { name: "Noch nie geöffnet", query: "status=draft,letter_sent&aktiv=never" },
  { name: "Gewonnen", query: "status=won" },
];

/** Normalises a stored or typed view query so equal views compare equal. */
export function canonicalViewQuery(query: string): string {
  return serializeListQuery(parseListQuery(new URLSearchParams(query)));
}
