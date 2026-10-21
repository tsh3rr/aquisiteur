"use client";

import { MessageCircle, MessageSquareText, Phone, X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  isFastScrollUp,
  NUDGE_SCROLL_AWAY,
  nudgeCopy,
  offerRequestText,
  pickNudge,
  showStickyBar,
  type NudgeId,
} from "@/domain/nudges";
import type { NudgeSettings } from "@/domain/workspace-settings";
import { clsx as cn } from "clsx";
import type { ChatPanelProps } from "./chat-panel";
import { onSignals, track, type Signals } from "./tracking-client";

export interface ContactLayerProps {
  slug: string;
  chat: { enabled: boolean; responseTime: string };
  nudges: NudgeSettings;
  owner: { name: string; photo: string | null };
  /** wa.me link with the prefilled text, for the WhatsApp handover and the bar. */
  whatsappHref: string | null;
  phoneHref: string | null;
  /** Id of the contact block, the target when chat is off. */
  contactBlockId: string | null;
  /** A chat button was pressed before the layer had loaded (ContactLayerLazy). */
  openWith?: OpenSource;
}

export type OpenSource = "launcher" | "contact" | "nudge" | "bar";
const storageKey = (slug: string) => `aq-chat:${slug}`;

function storedChat(slug: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(slug));
  } catch {
    return null;
  }
}

/**
 * Everything that invites contact on the public exposé (§7.4, §7.5): the
 * chat launcher and panel, one behaviour-based nudge per page view, and the
 * sticky contact bar on phones. Never modal, never steals focus; the nudge
 * is announced through a polite live region.
 */
export function ContactLayer(props: ContactLayerProps) {
  const { slug, chat, nudges } = props;
  const [signals, setSignals] = useState<Signals | null>(null);
  const [exitIntent, setExitIntent] = useState(false);
  const [nudge, setNudge] = useState<NudgeId | null>(null);
  const [nudgeShown, setNudgeShown] = useState(false);
  const [open, setOpen] = useState(Boolean(props.openWith) && chat.enabled);
  const [Panel, setPanel] = useState<ComponentType<ChatPanelProps> | null>(null);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const launcher = useRef<HTMLButtonElement>(null);

  useEffect(() => onSignals(setSignals), []);

  const loadPanel = () => import("./chat-panel").then((module) => setPanel(() => module.ChatPanel));

  // A conversation from earlier in this tab: reconnect so replies arrive.
  useEffect(() => {
    if (chat.enabled && storedChat(slug)) void loadPanel();
  }, [chat.enabled, slug]);

  // Opened by a chat button before this layer had loaded.
  const openedEarly = useRef(props.openWith);
  useEffect(() => {
    const source = openedEarly.current;
    if (!source) return;
    if (chat.enabled) {
      track({ type: "chat_open", source });
      void loadPanel();
    } else if (props.contactBlockId) {
      document.getElementById(props.contactBlockId)?.scrollIntoView({ behavior: "smooth" });
    }
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openChat = (source: OpenSource, text?: string) => {
    if (!chat.enabled) {
      if (props.contactBlockId) {
        document.getElementById(props.contactBlockId)?.scrollIntoView({ behavior: "smooth" });
      }
      return;
    }
    track({ type: "chat_open", source });
    if (text) setPrefill(text);
    setNudge(null);
    setUnread(0);
    setOpen(true);
    if (!Panel) void loadPanel();
  };

  // Buttons elsewhere on the page (contact block) open the chat.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const trigger = (event.target as Element | null)?.closest<HTMLElement>("[data-open-chat]");
      if (!trigger) return;
      event.preventDefault();
      openChat((trigger.dataset.openChat as OpenSource) || "contact");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  });

  // Exit intent: towards the tab bar on desktop, a quick flick up on phones.
  useEffect(() => {
    if (!nudges.enabled || !nudges.exitIntent) return;
    const onMouseOut = (event: MouseEvent) => {
      if (!event.relatedTarget && event.clientY <= 0) setExitIntent(true);
    };
    let lastY = window.scrollY;
    let lastAt = performance.now();
    const onScroll = () => {
      const now = performance.now();
      const delta = window.scrollY - lastY;
      if (isFastScrollUp(delta, now - lastAt) && window.scrollY > window.innerHeight) {
        setExitIntent(true);
      }
      if (now - lastAt > 250) {
        lastY = window.scrollY;
        lastAt = now;
      }
    };
    document.addEventListener("mouseout", onMouseOut);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("scroll", onScroll);
    };
  }, [nudges.enabled, nudges.exitIntent]);

  // At most one nudge per page view: the first one that fits is latched.
  const candidate =
    signals && !nudgeShown
      ? pickNudge(
          {
            readRatio: signals.sectionTotal ? signals.sectionsSeen / signals.sectionTotal : 0,
            activeSeconds: signals.activeSeconds,
            pricingTouched: signals.pricingTouched,
            returning: signals.returning,
            exitIntent,
            chatOpen: open,
            shown: nudgeShown,
          },
          nudges,
        )
      : null;
  if (candidate) {
    setNudge(candidate);
    setNudgeShown(true);
  }
  useEffect(() => {
    if (nudge) track({ type: "nudge_shown", nudge });
    // Reported when it appears; closing sets it to null.
  }, [nudge]);

  useEffect(() => {
    if (!nudge) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      track({ type: "nudge_dismissed", nudge });
      setNudge(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [nudge]);

  // Reading on past the question folds the card back into the launcher.
  useEffect(() => {
    if (!nudge) return;
    const from = window.scrollY;
    // The scroll that triggered it (a flick up on phones) may still be gliding.
    const settled = performance.now() + 1200;
    const onScroll = () => {
      if (performance.now() < settled) return;
      if (Math.abs(window.scrollY - from) < window.innerHeight * NUDGE_SCROLL_AWAY) return;
      track({ type: "nudge_dismissed", nudge });
      setNudge(null);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [nudge]);

  const closeNudge = () => {
    if (nudge) track({ type: "nudge_dismissed", nudge });
    setNudge(null);
  };

  const actOnNudge = () => {
    if (!nudge) return;
    track({ type: "nudge_clicked", nudge });
    const text =
      nudge === "pricing"
        ? offerRequestText(
            [...document.querySelectorAll<HTMLInputElement>("[data-pricing-option]:checked")].map(
              (input) => input.dataset.optionTitle ?? "",
            ),
          )
        : undefined;
    openChat("nudge", text);
  };

  const copy = nudge
    ? nudgeCopy(nudge, { responseTime: chat.responseTime, chat: chat.enabled })
    : null;
  const bar = signals ? showStickyBar(signals.scrollRatio, nudges) && !open : false;
  const available = signals?.available ?? false;

  // The launcher and the nudge are one element: a nudge expands the launcher
  // into a small card with the question, and it folds back on its own.
  const launcherVisible = chat.enabled && !open && !copy;
  return (
    <div className="print:hidden">
      <div
        className={cn(
          "fixed right-[max(1rem,calc(env(safe-area-inset-right)+0.5rem))] z-40 flex flex-col items-end",
          bar
            ? "bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4"
            : "bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.25rem))]",
        )}
      >
        <div aria-live="polite">
          {copy ? (
            <div
              role="group"
              aria-label="Hinweis"
              className="w-[min(22rem,calc(100vw-2rem))] origin-bottom-right rounded-[1.75rem] border border-border bg-surface p-2 shadow-xl motion-safe:animate-[nudge-in_240ms_ease-out]"
            >
              <div className="flex items-start gap-3 py-2 pl-2">
                {props.owner.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- pre-scaled asset
                  <img
                    src={props.owner.photo}
                    alt=""
                    width={40}
                    height={40}
                    className="size-10 shrink-0 rounded-full object-cover"
                  />
                ) : null}
                <p className="flex-1 pt-0.5 text-sm">
                  <span className="font-semibold">{props.owner.name}: </span>
                  {copy.text}
                </p>
                <button
                  type="button"
                  onClick={closeNudge}
                  className="-mt-1 grid size-11 shrink-0 place-items-center rounded-full text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-ring"
                >
                  <X aria-hidden className="size-4" />
                  <span className="sr-only">Hinweis schließen</span>
                </button>
              </div>
              <button
                type="button"
                onClick={actOnNudge}
                className={cn(launcherClass, "flex w-full")}
              >
                {chat.enabled ? <ChatIcon available={available} /> : null}
                <span>{copy.action}</span>
              </button>
            </div>
          ) : null}
        </div>

        {launcherVisible ? (
          <button
            ref={launcher}
            type="button"
            onClick={() => openChat("launcher")}
            onPointerEnter={() => void loadPanel()}
            className={cn(launcherClass, bar ? "hidden md:inline-flex" : "inline-flex")}
          >
            <ChatIcon available={available} />
            <span>Chat</span>
            {available ? <span className="text-sm font-normal">verfügbar</span> : null}
            {unread > 0 ? (
              <span className="grid min-w-5 place-items-center rounded-full bg-surface px-1.5 text-xs leading-5 text-foreground">
                {unread}
                <span className="sr-only"> neue Antworten</span>
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {bar ? (
        <nav
          aria-label="Kontakt"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pt-2 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] backdrop-blur md:hidden"
        >
          <ul className="flex gap-2">
            {chat.enabled ? (
              <li className="flex-1">
                <button type="button" onClick={() => openChat("bar")} className={barItem(true)}>
                  <MessageSquareText aria-hidden className="size-5" /> Chat
                  {unread > 0 ? <span className="sr-only"> ({unread} neu)</span> : null}
                </button>
              </li>
            ) : null}
            {props.whatsappHref ? (
              <li className="flex-1">
                <a
                  href={props.whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-contact-channel="whatsapp"
                  className={barItem(!chat.enabled)}
                >
                  <MessageCircle aria-hidden className="size-5" /> WhatsApp
                </a>
              </li>
            ) : null}
            {props.phoneHref ? (
              <li className="flex-1">
                <a href={props.phoneHref} data-contact-channel="phone" className={barItem(false)}>
                  <Phone aria-hidden className="size-5" /> Anrufen
                </a>
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}

      {Panel ? (
        <Panel
          slug={slug}
          open={open}
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => launcher.current?.focus());
          }}
          onUnread={(count) => setUnread(open ? 0 : count)}
          prefill={prefill}
          responseTime={chat.responseTime}
          owner={props.owner}
          whatsappHref={props.whatsappHref}
          available={available}
        />
      ) : null}
    </div>
  );
}

function barItem(primary: boolean) {
  return cn(
    "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
    primary
      ? "bg-accent text-accent-foreground"
      : "border border-border bg-surface text-foreground",
  );
}

// No display utility here: callers add exactly one, since clsx does not resolve conflicts.
const launcherClass =
  "group h-14 items-center justify-center gap-2.5 rounded-full bg-accent px-5 leading-none font-semibold text-accent-foreground shadow-lg hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** Chat icon with a small presence dot, cut out of the button by a ring in the button's colour. */
function ChatIcon({ available }: { available: boolean }) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center">
      <MessageSquareText aria-hidden className="size-5" />
      {available ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-success ring-2 ring-accent group-hover:ring-accent-hover"
        />
      ) : null}
    </span>
  );
}
