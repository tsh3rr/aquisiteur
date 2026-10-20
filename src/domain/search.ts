import { z } from "zod";

/**
 * Global search and command palette (§7.8): the fixed commands (pages and
 * actions), their keyboard shortcuts, and the matching that ranks them.
 * Records (prospects, exposés, campaigns) come from the server; this module
 * only decides how a query compares to a label. Pure, no I/O.
 */

export const SEARCH_MAX_LENGTH = 100;
/** Hits per record group; the palette stays short enough to scan. */
export const SEARCH_GROUP_LIMIT = 6;

export const searchQuerySchema = z.string().trim().min(1).max(SEARCH_MAX_LENGTH);

export type SearchHitKind = "prospect" | "expose" | "campaign" | "task";

export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  title: string;
  /** Second line: city, company, status; plain text. */
  detail: string | null;
  href: string;
}

export type CommandId =
  | "go.today"
  | "go.prospects"
  | "go.pipeline"
  | "go.campaigns"
  | "go.tasks"
  | "go.letters"
  | "go.analytics"
  | "go.chat"
  | "go.exposes"
  | "go.notifications"
  | "go.settings"
  | "new.prospect"
  | "new.import"
  | "new.letter"
  | "theme.light"
  | "theme.dark"
  | "theme.system"
  | "help.shortcuts";

export interface Command {
  id: CommandId;
  label: string;
  group: "Seiten" | "Aktionen";
  /** Extra words that should find this command ("crm", "neu"). */
  keywords: string[];
  /** Target page for navigation commands; actions without one run in the client. */
  href?: string;
  /** Key sequence, e.g. ["g", "k"]; shown in the palette and the help. */
  keys?: string[];
}

export const COMMANDS: readonly Command[] = [
  {
    id: "go.today",
    label: "Heute",
    group: "Seiten",
    keywords: ["start", "dashboard"],
    href: "/",
    keys: ["g", "h"],
  },
  {
    id: "go.prospects",
    label: "Kunden",
    group: "Seiten",
    keywords: ["kundenliste", "prospects", "leads"],
    href: "/kunden",
    keys: ["g", "k"],
  },
  {
    id: "go.pipeline",
    label: "Pipeline",
    group: "Seiten",
    keywords: ["kanban", "status"],
    href: "/kunden/pipeline",
    keys: ["g", "p"],
  },
  {
    id: "go.tasks",
    label: "Aufgaben",
    group: "Seiten",
    keywords: ["wiedervorlagen", "todo", "erinnerung", "fällig"],
    href: "/aufgaben",
    keys: ["g", "w"],
  },
  {
    id: "go.campaigns",
    label: "Kampagnen",
    group: "Seiten",
    keywords: ["aktionen"],
    href: "/kampagnen",
    keys: ["g", "m"],
  },
  {
    id: "go.letters",
    label: "Briefe",
    group: "Seiten",
    keywords: ["versand", "druck", "pdf"],
    href: "/briefe",
    keys: ["g", "b"],
  },
  {
    id: "go.analytics",
    label: "Auswertung",
    group: "Seiten",
    keywords: ["kpi", "funnel", "statistik", "dashboard"],
    href: "/auswertung",
    keys: ["g", "a"],
  },
  {
    id: "go.chat",
    label: "Chat",
    group: "Seiten",
    keywords: ["nachrichten", "rückruf", "anfragen"],
    href: "/chat",
    keys: ["g", "c"],
  },
  {
    id: "go.exposes",
    label: "Exposés",
    group: "Seiten",
    keywords: ["angebote", "seiten"],
    href: "/exposes",
    keys: ["g", "e"],
  },
  {
    id: "go.notifications",
    label: "Benachrichtigungen",
    group: "Seiten",
    keywords: ["mitteilungen", "push"],
    href: "/benachrichtigungen",
    keys: ["g", "n"],
  },
  {
    id: "go.settings",
    label: "Einstellungen",
    group: "Seiten",
    keywords: ["profil", "konto", "settings"],
    href: "/settings",
    keys: ["g", "s"],
  },
  {
    id: "new.prospect",
    label: "Neuen Kunden anlegen",
    group: "Aktionen",
    keywords: ["kunde", "neu", "erstellen", "hinzufügen"],
    href: "/kunden/neu",
    keys: ["n", "k"],
  },
  {
    id: "new.import",
    label: "Kunden importieren (CSV)",
    group: "Aktionen",
    keywords: ["import", "csv", "hochladen"],
    href: "/kunden/import",
  },
  {
    id: "new.letter",
    label: "Briefe erzeugen",
    group: "Aktionen",
    keywords: ["brief", "neu", "pdf", "drucken"],
    href: "/briefe/neu",
    keys: ["n", "b"],
  },
  {
    id: "theme.light",
    label: "Helles Design",
    group: "Aktionen",
    keywords: ["farbschema", "theme", "hell"],
  },
  {
    id: "theme.dark",
    label: "Dunkles Design",
    group: "Aktionen",
    keywords: ["farbschema", "theme", "dunkel", "nacht"],
  },
  {
    id: "theme.system",
    label: "Design wie System",
    group: "Aktionen",
    keywords: ["farbschema", "theme", "automatisch"],
  },
  {
    id: "help.shortcuts",
    label: "Tastaturkürzel anzeigen",
    group: "Aktionen",
    keywords: ["hilfe", "tastatur", "shortcuts"],
    keys: ["?"],
  },
];

/** Lower case, umlauts and accents folded, so "mueller", "muller" and "Müller" meet. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Both spellings of a folded umlaut, so "muller" also finds "mueller". */
function variants(text: string): string[] {
  const folded = normalize(text);
  const short = folded.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
  return short === folded ? [folded] : [folded, short];
}

/**
 * 0 for no match, higher is better: label start, word start, anywhere in the
 * label, then keywords. Every query word must match somewhere.
 */
export function scoreText(query: string, label: string, keywords: readonly string[] = []): number {
  const words = normalize(query).split(" ").filter(Boolean);
  if (words.length === 0) return 0;
  const labels = variants(label);
  const extras = keywords.flatMap(variants);
  let total = 0;
  for (const word of words) {
    const forms = variants(word);
    let best = 0;
    for (const form of forms) {
      for (const text of labels) {
        if (text.startsWith(form)) best = Math.max(best, 4);
        else if (text.split(/[\s\-/(),.]+/).some((part) => part.startsWith(form))) {
          best = Math.max(best, 3);
        } else if (text.includes(form)) best = Math.max(best, 2);
      }
      if (best === 0 && extras.some((extra) => extra.startsWith(form))) best = 1;
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Commands for the query, best first; all of them for an empty query. */
export function matchCommands(query: string, commands: readonly Command[] = COMMANDS): Command[] {
  if (!query.trim()) return [...commands];
  return commands
    .map((command, index) => ({
      command,
      index,
      score: scoreText(query, command.label, command.keywords),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}

/** The command bound to a finished key sequence, or whether more keys may follow. */
export function resolveSequence(
  keys: readonly string[],
  commands: readonly Command[] = COMMANDS,
): { command: Command | null; pending: boolean } {
  const joined = keys.join(" ");
  const bound = commands.filter((command) => command.keys);
  const command = bound.find((c) => c.keys!.join(" ") === joined) ?? null;
  const pending =
    !command &&
    bound.some((c) => c.keys!.length > keys.length && c.keys!.join(" ").startsWith(`${joined} `));
  return { command, pending };
}

/** `%` and `_` stay literal in ILIKE patterns. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
