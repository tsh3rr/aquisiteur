/**
 * The exposé's own tracking script (§6.3): no cookies, no storage; the
 * visit token lives in memory for this page view only. Events are batched
 * and sent with fetch(keepalive) or, when the page goes away, sendBeacon.
 * Kept dependency-free and small (< 5 KB gzip).
 */

type TrackEvent = { type: string; [key: string]: unknown };

const HEARTBEAT_MS = 15_000;
const DWELL_MIN_MS = 3_000;
const HOVER_MS = 1_000;
const SCROLL_MARKS = [25, 50, 75, 100];

let started = 0;
let token: string | null = null;
let queue: TrackEvent[] = [];
/** Slug whose visit this page already started (survives a remount). */
let startedSlug: string | null = null;
let active = false;

/**
 * What the page observed so far, for the nudges and the contact bar
 * (§7.4). Lives in memory like everything else here.
 */
export interface Signals {
  sectionsSeen: number;
  sectionTotal: number;
  activeSeconds: number;
  pricingTouched: boolean;
  /** Bottom of the viewport relative to the page height, 0–1. */
  scrollRatio: number;
  returning: boolean;
  available: boolean;
}

let signals: Signals = {
  sectionsSeen: 0,
  sectionTotal: 0,
  activeSeconds: 0,
  pricingTouched: false,
  scrollRatio: 0,
  returning: false,
  available: false,
};
const signalListeners = new Set<(signals: Signals) => void>();
let tokenWaiters: ((token: string | null) => void)[] = [];
/** /t/start answered (with or without a token). */
let ready = false;

function update(patch: Partial<Signals>) {
  signals = { ...signals, ...patch };
  for (const listener of signalListeners) listener(signals);
}

/** Calls `listener` now and on every change; returns the unsubscribe function. */
export function onSignals(listener: (signals: Signals) => void): () => void {
  signalListeners.add(listener);
  listener(signals);
  return () => signalListeners.delete(listener);
}

/** The visit token once the visit started (null if it could not start). */
export function visitToken(): Promise<string | null> {
  if (ready) return Promise.resolve(token);
  return new Promise((resolve) => tokenWaiters.push(resolve));
}

const at = () => Math.round(performance.now() - started);

function post(path: string, body: unknown, beacon = false) {
  const json = JSON.stringify(body);
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon(path, new Blob([json], { type: "application/json" }));
    return Promise.resolve(null);
  }
  return fetch(path, {
    method: "POST",
    body: json,
    keepalive: true,
    headers: { "content-type": "application/json" },
  }).catch(() => null);
}

function flush(beacon = false) {
  if (!token || queue.length === 0) return;
  const events = queue.slice(0, 50);
  queue = queue.slice(50);
  void post("/t/e", { token, events }, beacon);
}

/** Records an event; harmless before start() or in the cockpit preview. */
export function track(event: TrackEvent) {
  if (!active) return;
  queue.push({ ...event, at: at() });
  if (queue.length >= 20) flush();
}

/** A share link of its own for „Mit Kollegen teilen“, or null to share the page URL. */
export async function shareUrl(): Promise<string | null> {
  if (!token) return null;
  const response = await post("/t/share", { token });
  if (!response?.ok) return null;
  const data = (await response.json()) as { url?: string };
  return data.url ?? null;
}

function blockOf(element: Element | null): string | undefined {
  return element?.closest("section[data-block]")?.id || undefined;
}

const typeOf = (id: string) =>
  (document.getElementById(id) as HTMLElement | null)?.dataset.block || undefined;

const CONTACT_TARGET = "[data-contact-channel],[data-open-chat],[data-callback]";
const channelOf = (element: HTMLElement) =>
  element.dataset.contactChannel ?? ("openChat" in element.dataset ? "chat" : "callback");

/** Starts tracking for the exposé `slug`; returns the cleanup function. */
export function start(slug: string): () => void {
  if (active) return () => {};
  active = true;
  if (startedSlug !== slug) {
    // One visit per page view, even if the component remounts.
    startedSlug = slug;
    started = performance.now();
    queue = [];
    token = null;
    ready = false;
    const url = new URL(window.location.href);
    const ticket = url.searchParams.get("v") ?? undefined;
    if (ticket) {
      // The ticket is single-use; keep it out of bookmarks and forwarded links.
      url.searchParams.delete("v");
      history.replaceState(history.state, "", url);
    }
    void post("/t/start", {
      slug,
      ticket,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
      .then((response) => (response?.ok ? response.json() : null))
      .then((data: { token?: string; returning?: boolean; available?: boolean } | null) => {
        token = data?.token ?? null;
        ready = true;
        update({ returning: Boolean(data?.returning), available: Boolean(data?.available) });
        for (const resolve of tokenWaiters) resolve(token);
        tokenWaiters = [];
        flush();
      });
  }

  // Active time: one heartbeat per 15 s while the tab is visible.
  let lastTick = Date.now();
  const heartbeat = window.setInterval(() => {
    const now = Date.now();
    const seconds = Math.round((now - lastTick) / 1000);
    lastTick = now;
    if (document.visibilityState === "visible" && seconds > 0) {
      track({ type: "heartbeat", seconds: Math.min(seconds, 60) });
      update({ activeSeconds: signals.activeSeconds + Math.min(seconds, 60) });
      flush();
    }
  }, HEARTBEAT_MS);

  // Sections: viewed when ≥ 50 % visible, read (dwell) after ≥ 3 s.
  const seen = new Set<string>();
  const visibleSince = new Map<string, number>();
  const endDwell = (id: string) => {
    const since = visibleSince.get(id);
    visibleSince.delete(id);
    if (since === undefined) return;
    const ms = Date.now() - since;
    if (ms >= DWELL_MIN_MS) {
      track({
        type: "section_dwell",
        blockId: id,
        blockType: typeOf(id),
        seconds: Math.min(Math.round(ms / 1000), 3600),
      });
    }
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = entry.target.id;
        if (!id) continue;
        if (entry.isIntersecting && document.visibilityState === "visible") {
          if (!seen.has(id)) {
            seen.add(id);
            track({ type: "section_view", blockId: id, blockType: typeOf(id) });
            update({ sectionsSeen: seen.size });
          }
          if (!visibleSince.has(id)) visibleSince.set(id, Date.now());
        } else {
          endDwell(id);
        }
      }
    },
    { threshold: 0.5 },
  );
  const sections = document.querySelectorAll("section[data-block][id]");
  sections.forEach((section) => observer.observe(section));
  update({ sectionTotal: sections.length });

  // Scroll depth at 25/50/75/100 %.
  let reached = 0;
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const doc = document.documentElement;
      const ratio = Math.min(1, (window.scrollY + window.innerHeight) / doc.scrollHeight);
      if (Math.abs(ratio - signals.scrollRatio) >= 0.02) update({ scrollRatio: ratio });
      const percent = Math.round(ratio * 100);
      const mark = SCROLL_MARKS.filter((m) => m <= percent).pop() ?? 0;
      if (mark > reached) {
        reached = mark;
        track({ type: "scroll_depth", percent: mark });
      }
    });
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const contact = target?.closest<HTMLElement>("[data-contact-channel]");
    if (contact) {
      track({
        type: "contact_click",
        channel: contact.dataset.contactChannel,
        blockId: blockOf(contact),
      });
      flush();
      return;
    }
    const cta = target?.closest("[data-cta]");
    if (cta) track({ type: "cta_click", blockId: blockOf(cta) });
  };
  const onChange = (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    const optionId = input?.dataset?.pricingOption;
    if (!input || !optionId) return;
    track({ type: "pricing_change", blockId: blockOf(input), optionId, selected: input.checked });
    update({ pricingTouched: true });
  };
  const onPlay = (event: Event) => {
    track({ type: "media_play", blockId: blockOf(event.target as Element) });
  };
  const onPrint = () => track({ type: "pdf_download" });

  // Lingering on a contact button (≥ 1 s, pointer or keyboard focus), once per channel.
  const hovered = new Set<string>();
  let hoverTimer = 0;
  let hoverTarget: HTMLElement | null = null;
  const targetOf = (node: EventTarget | null) =>
    node instanceof Element ? node.closest<HTMLElement>(CONTACT_TARGET) : null;
  const onEnter = (event: Event) => {
    const button = targetOf(event.target);
    if (!button || button === hoverTarget) return;
    const channel = channelOf(button);
    if (hovered.has(channel)) return;
    window.clearTimeout(hoverTimer);
    hoverTarget = button;
    hoverTimer = window.setTimeout(() => {
      hovered.add(channel);
      track({ type: "cta_hover", channel, blockId: blockOf(button) });
    }, HOVER_MS);
  };
  const onLeave = (event: Event) => {
    const to = targetOf((event as PointerEvent | FocusEvent).relatedTarget);
    if (to && to === hoverTarget) return;
    window.clearTimeout(hoverTimer);
    hoverTarget = null;
  };
  // Copying the owner's number or address from the contact block.
  const onCopy = () => {
    const node = document.getSelection()?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    const channel = element?.closest<HTMLElement>("[data-contact-channel]")?.dataset.contactChannel;
    if (channel === "email" || channel === "phone" || channel === "whatsapp" || channel === "sms") {
      track({ type: "copy_contact", channel: channel === "email" ? "email" : "phone" });
      flush();
    }
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") {
      for (const id of [...visibleSince.keys()]) endDwell(id);
      flush(true);
    }
  };
  const onPageHide = () => flush(true);

  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("click", onClick);
  document.addEventListener("pointerover", onEnter);
  document.addEventListener("focusin", onEnter);
  document.addEventListener("pointerout", onLeave);
  document.addEventListener("focusout", onLeave);
  document.addEventListener("copy", onCopy);
  document.addEventListener("change", onChange);
  document.addEventListener("play", onPlay, true);
  window.addEventListener("beforeprint", onPrint);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    window.clearInterval(heartbeat);
    observer.disconnect();
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("click", onClick);
    document.removeEventListener("pointerover", onEnter);
    document.removeEventListener("focusin", onEnter);
    document.removeEventListener("pointerout", onLeave);
    document.removeEventListener("focusout", onLeave);
    document.removeEventListener("copy", onCopy);
    window.clearTimeout(hoverTimer);
    document.removeEventListener("change", onChange);
    document.removeEventListener("play", onPlay, true);
    window.removeEventListener("beforeprint", onPrint);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
    flush(true);
    active = false;
  };
}
