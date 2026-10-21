"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CONSENT_NOTICE,
  CONSENT_STORAGE_KEY,
  LEGACY_CONSENT_STORAGE_KEY,
  serializeConsent,
  storedConsent,
  type StoredConsent,
} from "@/domain/tracking/consent";
import { sendConsent, setStatistics, shouldAskConsent, visitToken } from "./tracking-client";

export interface ConsentNoticeProps {
  privacyHref: string | null;
  company: string;
  /** Recording offered by the workspace, with its retention in days. */
  replay: { enabled: boolean; days: number };
}

/** "asking": first layer · "choosing": the switches · "done": answered or closed. */
type Phase = "waiting" | "asking" | "choosing" | "done";

const NONE: StoredConsent = { statistics: false, replay: false };

function remember(choice: StoredConsent) {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent(choice));
    localStorage.removeItem(LEGACY_CONSENT_STORAGE_KEY);
  } catch {
    // Storage blocked: the visitor is simply asked again next time.
  }
}

function recall(): StoredConsent | null {
  try {
    return storedConsent(localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

const button =
  "inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border-strong bg-surface px-3 text-sm font-semibold text-foreground hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The consent notice (§9, ADR-0065): a bar that never blocks reading, three
 * equal buttons, switches that start off. Ablehnen, nothing ticked and
 * ignoring it all leave only the basis; closing it is no answer, so the
 * next visit asks again. „Datenschutz-Einstellungen“ in the footer reopens
 * the switches at any time.
 */
export function ConsentNotice({ privacyHref, company, replay }: ConsentNoticeProps) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [current, setCurrent] = useState<StoredConsent>(NONE);
  const [draft, setDraft] = useState<StoredConsent>(NONE);
  const [recording, setRecording] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  const allowed = useRef(true);
  const applied = useRef<StoredConsent>(NONE);

  /** The switches start from what applies now. */
  const openSettings = () => {
    setDraft(applied.current);
    setPhase("choosing");
  };

  const startRecording = async () => {
    if (stop.current) return;
    const token = await visitToken();
    if (!token || !(await sendConsent("replay", "given"))) return;
    const recorder = await import("./replay-recorder");
    stop.current = await recorder.startRecording(token);
    setRecording(true);
  };

  const stopRecording = () => {
    stop.current?.();
    stop.current = null;
    setRecording(false);
  };

  /** Applies a choice, stores it, and sends one decision per purpose that changed. */
  const decide = (choice: StoredConsent, before: StoredConsent | null) => {
    const next = { statistics: choice.statistics, replay: replay.enabled && choice.replay };
    remember(next);
    applied.current = next;
    setCurrent(next);
    setPhase("done");
    setStatistics(next.statistics);
    if (before?.statistics !== next.statistics || before === null) {
      void sendConsent(
        "statistics",
        next.statistics ? "given" : before?.statistics ? "withdrawn" : "denied",
      );
    }
    if (replay.enabled) {
      if (next.replay && !before?.replay) void startRecording();
      if (!next.replay && before?.replay) {
        stopRecording();
        void sendConsent("replay", "withdrawn");
      }
      if (!next.replay && !before) void sendConsent("replay", "denied");
    }
  };

  useEffect(() => {
    let cancelled = false;
    const known = recall();
    void shouldAskConsent().then((ask) => {
      if (cancelled) return;
      allowed.current = ask;
      if (!ask) return;
      if (known) {
        applied.current = known;
        setCurrent(known);
        setPhase("done");
        // The statistics „yes“ is sent by the tracking script itself, before its first batch.
        if (known.replay && replay.enabled) void startRecording();
      } else {
        setPhase("asking");
      }
    });
    const onSettings = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("[data-consent-settings]") || !allowed.current) return;
      event.preventDefault();
      openSettings();
    };
    document.addEventListener("click", onSettings);
    return () => {
      cancelled = true;
      document.removeEventListener("click", onSettings);
      stop.current?.();
    };
    // Runs once per page view; the props do not change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answered = recall() !== null;
  const before = answered ? current : null;

  if (phase === "asking" || phase === "choosing") {
    return (
      <section
        aria-labelledby="consent-title"
        data-replay-block
        className="fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-4 shadow-lg md:inset-x-auto md:top-auto md:bottom-4 md:left-4 md:w-[26rem] print:hidden"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="consent-title" className="pt-2 text-sm font-semibold">
            {phase === "choosing" ? CONSENT_NOTICE.settings : CONSENT_NOTICE.title}
          </h2>
          <button
            type="button"
            aria-label={CONSENT_NOTICE.close}
            onClick={() => setPhase("done")}
            className="-mt-1 -mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        {phase === "asking" ? (
          <>
            <p className="mt-1 text-sm text-foreground-muted">
              {CONSENT_NOTICE.body(company)}{" "}
              {privacyHref ? (
                <a href={privacyHref} className="underline underline-offset-2">
                  {CONSENT_NOTICE.more}
                </a>
              ) : null}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={button} onClick={() => decide(NONE, before)}>
                {CONSENT_NOTICE.reject}
              </button>
              <button type="button" className={button} onClick={openSettings}>
                {CONSENT_NOTICE.choose}
              </button>
              <button
                type="button"
                className={button}
                onClick={() => decide({ statistics: true, replay: false }, before)}
              >
                {CONSENT_NOTICE.accept}
              </button>
            </div>
          </>
        ) : (
          <form
            className="mt-2 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              decide(draft, before);
            }}
          >
            <div className="rounded-xl bg-surface-sunken p-3 text-sm">
              <p className="font-semibold">{CONSENT_NOTICE.necessary.label} · immer aktiv</p>
              <p className="mt-1 text-foreground-muted">{CONSENT_NOTICE.necessary.text}</p>
            </div>
            <label className="flex gap-3 rounded-xl border border-border p-3 text-sm">
              <input
                type="checkbox"
                checked={draft.statistics}
                onChange={(event) => setDraft({ ...draft, statistics: event.target.checked })}
                className="mt-0.5 size-5 shrink-0 accent-(--color-accent)"
              />
              <span className="text-foreground-muted">
                <strong className="mb-1 block font-semibold text-foreground">
                  {CONSENT_NOTICE.statistics.label}
                </strong>
                {CONSENT_NOTICE.statistics.text}
              </span>
            </label>
            {replay.enabled ? (
              <label className="flex gap-3 rounded-xl border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.replay}
                  onChange={(event) => setDraft({ ...draft, replay: event.target.checked })}
                  className="mt-0.5 size-5 shrink-0 accent-(--color-accent)"
                />
                <span className="text-foreground-muted">
                  <strong className="mb-1 block font-semibold text-foreground">
                    {CONSENT_NOTICE.replay.label}
                  </strong>
                  {CONSENT_NOTICE.replay.text(replay.days)}
                </span>
              </label>
            ) : null}
            {privacyHref ? (
              <p className="text-sm text-foreground-muted">
                {CONSENT_NOTICE.revoke}{" "}
                <a href={privacyHref} className="underline underline-offset-2">
                  {CONSENT_NOTICE.more}
                </a>
                .
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={button}>
                {CONSENT_NOTICE.save}
              </button>
              <button
                type="button"
                className={button}
                onClick={() => decide({ statistics: true, replay: true }, before)}
              >
                {CONSENT_NOTICE.acceptAll}
              </button>
            </div>
          </form>
        )}
      </section>
    );
  }
  if (recording) {
    return (
      <div
        data-replay-block
        className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] z-30 md:bottom-4 md:left-4 print:hidden"
      >
        <button
          type="button"
          onClick={() => decide({ ...current, replay: false }, current)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface/95 px-4 text-xs text-foreground-muted shadow-sm backdrop-blur hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <span aria-hidden className="size-2 rounded-full bg-danger" />
          {CONSENT_NOTICE.recording}
        </button>
      </div>
    );
  }
  return null;
}
