"use client";

import {
  ArrowRight,
  FileText,
  Flag,
  Keyboard,
  ListChecks,
  Monitor,
  Moon,
  Plus,
  Search,
  Sun,
  Users,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import * as Dialog from "radix-ui/dialog";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { searchCockpit } from "@/app/(cockpit)/search-actions";
import { applyTheme } from "@/components/theme/theme-toggle";
import { Kbd } from "@/components/ui/misc";
import {
  COMMANDS,
  matchCommands,
  resolveSequence,
  SEARCH_MAX_LENGTH,
  type Command,
  type CommandId,
  type SearchHit,
  type SearchHitKind,
} from "@/domain/search";
import { cn } from "@/lib/cn";

/**
 * Global search, command palette and keyboard shortcuts (§7.8). ⌘K / Strg+K
 * opens the palette everywhere; single-key shortcuts ("/", "?", "g k") work
 * outside text fields and can be switched off (WCAG 2.1.4).
 */

const SHORTCUTS_KEY = "aq:single-key-shortcuts";
const SEQUENCE_TIMEOUT_MS = 1200;
const SEARCH_DEBOUNCE_MS = 150;

interface PaletteControls {
  /** `trigger` gets focus back on close; taps on iOS do not focus a button. */
  openPalette: (trigger?: HTMLElement) => void;
  openHelp: () => void;
}

const PaletteContext = createContext<PaletteControls>({
  openPalette: () => {},
  openHelp: () => {},
});

const noSubscribe = () => () => {};

/** ⌘ on Apple devices, Strg elsewhere; the server renders "Strg". */
export function useModifierLabel() {
  return useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Strg"),
    () => "Strg",
  );
}

const SHORTCUTS_EVENT = "aq:single-key-shortcuts";
/** Fallback when storage is blocked (private mode): the choice lasts for this page. */
let singleKeysInMemory: boolean | null = null;

function readSingleKeys(): boolean {
  try {
    const stored = localStorage.getItem(SHORTCUTS_KEY);
    if (stored) return stored !== "off";
  } catch {
    // Storage blocked; fall through.
  }
  return singleKeysInMemory ?? true;
}

function storeSingleKeys(on: boolean) {
  singleKeysInMemory = on;
  try {
    localStorage.setItem(SHORTCUTS_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked; the in-memory value above still applies.
  }
  window.dispatchEvent(new Event(SHORTCUTS_EVENT));
}

function subscribeSingleKeys(onChange: () => void) {
  window.addEventListener(SHORTCUTS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SHORTCUTS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest("[role=dialog]") !== null
  );
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const singleKeys = useSyncExternalStore(subscribeSingleKeys, readSingleKeys, () => true);
  const returnFocus = useRef<HTMLElement | null>(null);
  const sequence = useRef<string[]>([]);
  const sequenceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const run = useCallback(
    (command: Command) => {
      if (command.href) router.push(command.href as Route);
      else if (command.id === "theme.light") applyTheme("light");
      else if (command.id === "theme.dark") applyTheme("dark");
      else if (command.id === "theme.system") applyTheme("system");
      else if (command.id === "help.shortcuts") setHelpOpen(true);
    },
    [router],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setHelpOpen(false);
        returnFocus.current = null;
        setPaletteOpen((open) => !open);
        return;
      }
      if (!singleKeys || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTyping(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        returnFocus.current = null;
        setPaletteOpen(true);
        return;
      }
      if (event.key.length !== 1) return;

      clearTimeout(sequenceTimer.current);
      const keys = [...sequence.current, event.key.toLowerCase()];
      const { command, pending } = resolveSequence(event.key === "?" ? ["?"] : keys);
      if (command) {
        event.preventDefault();
        sequence.current = [];
        run(command);
      } else if (pending) {
        sequence.current = keys;
        sequenceTimer.current = setTimeout(() => (sequence.current = []), SEQUENCE_TIMEOUT_MS);
      } else {
        sequence.current = [];
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(sequenceTimer.current);
    };
  }, [run, singleKeys]);

  const controls = useMemo(
    () => ({
      openPalette: (trigger?: HTMLElement) => {
        returnFocus.current = trigger ?? null;
        setPaletteOpen(true);
      },
      openHelp: () => setHelpOpen(true),
    }),
    [],
  );

  return (
    <PaletteContext.Provider value={controls}>
      {children}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        returnFocus={returnFocus}
        onRun={(command) => {
          setPaletteOpen(false);
          run(command);
        }}
        onOpenRecord={(hit) => {
          setPaletteOpen(false);
          router.push(hit.href as Route);
        }}
      />
      <ShortcutHelp
        open={helpOpen}
        onOpenChange={setHelpOpen}
        singleKeys={singleKeys}
        onSingleKeysChange={storeSingleKeys}
      />
    </PaletteContext.Provider>
  );
}

export function usePalette() {
  return useContext(PaletteContext);
}

const KIND_LABELS: Record<SearchHitKind, string> = {
  prospect: "Kunden",
  expose: "Exposés",
  campaign: "Kampagnen",
  task: "Aufgaben",
};

const KIND_ICONS: Record<SearchHitKind, typeof Users> = {
  prospect: Users,
  expose: FileText,
  campaign: Flag,
  task: ListChecks,
};

const COMMAND_ICONS: Partial<Record<CommandId, typeof Users>> = {
  "theme.light": Sun,
  "theme.dark": Moon,
  "theme.system": Monitor,
  "help.shortcuts": Keyboard,
  "new.prospect": Plus,
  "new.import": Plus,
  "new.letter": Plus,
};

type Option =
  { type: "hit"; key: string; hit: SearchHit } | { type: "command"; key: string; command: Command };

interface Group {
  label: string;
  options: Option[];
}

type SearchState =
  | { status: "idle"; hits: SearchHit[] }
  | { status: "loading"; hits: SearchHit[] }
  | { status: "done"; hits: SearchHit[] }
  | { status: "error"; hits: SearchHit[] };

/** Debounced record search; a newer query wins over a slower, older answer. */
function useRecordSearch(query: string): SearchState {
  const trimmed = query.trim();
  const [result, setResult] = useState({ query: "", hits: [] as SearchHit[], failed: false });

  useEffect(() => {
    if (!trimmed) return;
    let current = true;
    const timer = setTimeout(() => {
      searchCockpit(trimmed).then(
        (hits) => {
          if (current) setResult({ query: trimmed, hits, failed: false });
        },
        () => {
          if (current) setResult({ query: trimmed, hits: [], failed: true });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [trimmed]);

  if (!trimmed) return { status: "idle", hits: [] };
  if (result.query !== trimmed) return { status: "loading", hits: result.hits };
  return { status: result.failed ? "error" : "done", hits: result.hits };
}

function CommandPalette({
  open,
  onOpenChange,
  onRun,
  onOpenRecord,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRun: (command: Command) => void;
  onOpenRecord: (hit: SearchHit) => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 top-0 z-50 flex max-h-dvh flex-col overflow-hidden bg-surface shadow-lg outline-none",
            "pt-[env(safe-area-inset-top)] sm:inset-x-auto sm:top-[12vh] sm:left-1/2 sm:max-h-[min(36rem,76vh)] sm:w-[min(40rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:rounded-xl sm:border sm:border-border sm:pt-0",
          )}
          onCloseAutoFocus={(event) => {
            const trigger = returnFocus.current;
            if (trigger?.isConnected) {
              event.preventDefault();
              trigger.focus();
            }
          }}
        >
          {/* Mounted only while open, so every opening starts with an empty query. */}
          <PaletteBody onRun={onRun} onOpenRecord={onOpenRecord} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteBody({
  onRun,
  onOpenRecord,
}: {
  onRun: (command: Command) => void;
  onOpenRecord: (hit: SearchHit) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const search = useRecordSearch(query);

  const groups = useMemo<Group[]>(() => {
    const result: Group[] = [];
    for (const kind of ["prospect", "task", "expose", "campaign"] as const) {
      const hits = search.hits.filter((hit) => hit.kind === kind);
      if (hits.length > 0) {
        result.push({
          label: KIND_LABELS[kind],
          options: hits.map((hit) => ({ type: "hit", key: `${kind}-${hit.id}`, hit })),
        });
      }
    }
    const commands = matchCommands(query);
    for (const label of ["Seiten", "Aktionen"] as const) {
      const options = commands
        .filter((command) => command.group === label)
        .map((command) => ({ type: "command" as const, key: command.id, command }));
      if (options.length > 0) result.push({ label, options });
    }
    return result;
  }, [search.hits, query]);

  const options = groups.flatMap((group) => group.options);
  // An empty listbox is invalid ARIA: it is left out, the "no results" text sits outside it.
  const listVisible = options.length > 0 || search.status === "loading";
  // The first option is active until the user moves; a vanished option falls back to it.
  const activeIndex = Math.max(
    options.findIndex((option) => option.key === activeKey),
    0,
  );
  const activeOption = options[activeIndex];
  const optionId = (option: Option) => `${id}-${option.key}`;
  const setActive = (index: number) => setActiveKey(options[index]?.key ?? null);

  useEffect(() => {
    if (!activeOption) return;
    document.getElementById(optionId(activeOption))?.scrollIntoView({ block: "nearest" });
    // optionId only depends on the stable id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOption]);

  function choose(option: Option) {
    if (option.type === "hit") onOpenRecord(option.hit);
    else onRun(option.command);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const last = options.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(activeIndex >= last ? 0 : activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex <= 0 ? last : activeIndex - 1);
    } else if (event.key === "Home" && event.ctrlKey) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End" && event.ctrlKey) {
      event.preventDefault();
      setActive(last);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setActive(Math.min(activeIndex + 5, last));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      setActive(Math.max(activeIndex - 5, 0));
    } else if (event.key === "Enter" && activeOption) {
      event.preventDefault();
      choose(activeOption);
    }
  }

  const announcement = useMemo(() => {
    if (!query.trim()) return "";
    if (search.status === "loading") return "Suche läuft …";
    if (search.status === "error") return "Die Suche ist gerade nicht erreichbar.";
    if (search.status !== "done") return "";
    if (options.length === 0) return `Keine Treffer für „${query.trim()}“.`;
    return groups.map((group) => `${group.label}: ${group.options.length}`).join(", ");
  }, [groups, options.length, query, search.status]);

  return (
    <>
      <Dialog.Title className="sr-only">Suche und Befehle</Dialog.Title>
      <Dialog.Description className="sr-only">
        Kunden, Aufgaben, Exposés, Kampagnen und Befehle durchsuchen. Mit den Pfeiltasten auswählen,
        mit Eingabe öffnen, mit Escape schließen.
      </Dialog.Description>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search aria-hidden className="size-5 shrink-0 text-foreground-muted" />
        <input
          type="search"
          role="combobox"
          aria-label="Suchen"
          aria-expanded={listVisible}
          aria-controls={listVisible ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={SEARCH_MAX_LENGTH}
          placeholder="Kunde, Exposé, Kampagne oder Befehl …"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveKey(null);
          }}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-foreground-muted [&::-webkit-search-cancel-button]:hidden"
        />
        <Dialog.Close className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-sm text-foreground-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring sm:size-auto sm:px-1">
          <span className="sm:hidden">Fertig</span>
          <span className="hidden sm:inline-flex">
            <Kbd aria-hidden>Esc</Kbd>
            <span className="sr-only">Schließen</span>
          </span>
        </Dialog.Close>
      </div>

      <div role="status" className="sr-only">
        {announcement}
      </div>

      {listVisible ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Treffer"
          aria-busy={search.status === "loading"}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
        >
          {search.status === "loading" && search.hits.length === 0 ? (
            <div aria-hidden className="grid gap-1 p-1">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex h-12 items-center gap-3 px-2">
                  <span className="size-8 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none" />
                  <span className="h-3 w-40 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          ) : null}
          {groups.map((group) => (
            <div
              key={group.label}
              role="group"
              aria-labelledby={`${id}-${group.label}`}
              className="pb-2"
            >
              <div
                id={`${id}-${group.label}`}
                role="presentation"
                className="px-2 pt-2 pb-1 text-xs font-medium tracking-wide text-foreground-muted uppercase"
              >
                {group.label}
              </div>
              {group.options.map((option) => (
                <OptionRow
                  key={option.key}
                  id={optionId(option)}
                  option={option}
                  selected={option === activeOption}
                  onHover={() => setActiveKey(option.key)}
                  onChoose={() => choose(option)}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {/* Outside the listbox: a listbox may only hold options and groups. */}
      {query.trim() && search.status === "done" && options.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-foreground-muted">
          Keine Treffer für „{query.trim()}“. Versuchen Sie Firmenname, Ort, Ansprechpartner oder
          Ref-Code.
        </p>
      ) : null}
      {search.status === "error" ? (
        <p className="m-2 rounded-md bg-danger-soft px-3 py-3 text-sm text-danger-soft-foreground">
          Die Suche ist gerade nicht erreichbar. Befehle funktionieren weiter.
        </p>
      ) : null}

      <footer className="hidden items-center gap-4 border-t border-border px-4 py-2 text-xs text-foreground-muted sm:flex">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> auswählen
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> öffnen
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> schließen
        </span>
      </footer>
    </>
  );
}

function OptionRow({
  id,
  option,
  selected,
  onHover,
  onChoose,
}: {
  id: string;
  option: Option;
  selected: boolean;
  onHover: () => void;
  onChoose: () => void;
}) {
  const Icon =
    option.type === "hit"
      ? KIND_ICONS[option.hit.kind]
      : (COMMAND_ICONS[option.command.id] ?? ArrowRight);
  const title = option.type === "hit" ? option.hit.title : option.command.label;
  const detail = option.type === "hit" ? option.hit.detail : null;
  const keys = option.type === "command" ? option.command.keys : undefined;

  return (
    // Keyboard selection runs through the combobox input (aria-activedescendant).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      id={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseMove={selected ? undefined : onHover}
      onClick={onChoose}
      // Keeps focus in the input; the click still selects.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm",
        "aria-selected:bg-accent-soft aria-selected:text-accent-soft-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface-sunken text-foreground-muted",
          selected && "border-accent text-accent",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-medium">{title}</span>
        {detail ? <span className="truncate text-xs text-foreground-muted">{detail}</span> : null}
      </span>
      {keys ? (
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <span className="sr-only">Tastaturkürzel</span>
          {keys.map((key, index) => (
            <Kbd key={index}>{key.toUpperCase()}</Kbd>
          ))}
        </span>
      ) : null}
    </div>
  );
}

function ShortcutHelp({
  open,
  onOpenChange,
  singleKeys,
  onSingleKeysChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  singleKeys: boolean;
  onSingleKeysChange: (on: boolean) => void;
}) {
  const modifier = useModifierLabel();
  const switchId = useId();
  const rows: { keys: string[]; label: string }[] = [
    { keys: [modifier, "K"], label: "Suche und Befehle öffnen" },
    { keys: ["/"], label: "Suche öffnen" },
    { keys: ["?"], label: "Diese Übersicht" },
    ...COMMANDS.filter((command) => command.keys && command.id !== "help.shortcuts").map(
      (command) => ({
        keys: command.keys!.map((key) => key.toUpperCase()),
        label: command.label,
      }),
    ),
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed inset-x-3 top-[8vh] z-50 mx-auto grid max-h-[84dvh] max-w-lg gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-lg outline-none">
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <Dialog.Title className="text-lg font-semibold">Tastaturkürzel</Dialog.Title>
              <Dialog.Description className="text-sm text-foreground-muted">
                Folgen wie „G K“ nacheinander drücken, nicht gleichzeitig.
              </Dialog.Description>
            </div>
            <Dialog.Close className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-sm text-foreground-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring">
              <span aria-hidden>✕</span>
              <span className="sr-only">Schließen</span>
            </Dialog.Close>
          </div>
          <table className="w-full text-sm">
            <caption className="sr-only">Alle Tastaturkürzel</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Aktion</th>
                <th scope="col">Tasten</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-border first:border-t-0">
                  <td className="py-2 pr-4">{row.label}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <span className="sr-only">{row.keys.join(" dann ")}</span>
                    <span aria-hidden className="inline-flex gap-1">
                      {row.keys.map((key, index) => (
                        <Kbd key={index}>{key}</Kbd>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
            <input
              id={switchId}
              type="checkbox"
              aria-describedby={`${switchId}-hint`}
              className="mt-0.5 size-6 shrink-0 accent-accent"
              checked={singleKeys}
              onChange={(event) => onSingleKeysChange(event.target.checked)}
            />
            <div className="grid gap-0.5">
              <label htmlFor={switchId} className="font-medium">
                Kürzel mit einzelnen Tasten
              </label>
              <p id={`${switchId}-hint`} className="text-foreground-muted">
                „/“, „?“ und Folgen wie „G K“. {modifier} + K bleibt immer aktiv.
              </p>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Search entry in the sidebar (desktop) and the header (phone). */
export function SearchButton({ variant }: { variant: "sidebar" | "icon" }) {
  const { openPalette } = usePalette();
  const modifier = useModifierLabel();
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={(event) => openPalette(event.currentTarget)}
        className="inline-flex size-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        <Search aria-hidden className="size-5" />
        <span className="sr-only">Suchen</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={(event) => openPalette(event.currentTarget)}
      aria-keyshortcuts={modifier === "⌘" ? "Meta+K" : "Control+K"}
      className="flex h-11 w-full items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 text-sm text-foreground-muted shadow-sm transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
    >
      <Search aria-hidden className="size-4" />
      <span className="flex-1 text-left">Suchen …</span>
      <span aria-hidden className="flex gap-0.5">
        <Kbd>{modifier}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}
