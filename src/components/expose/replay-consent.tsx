"use client";

import { useEffect, useRef, useState } from "react";
import {
  CONSENT_STORAGE_KEY,
  REPLAY_NOTICE,
  REPLAY_NOTICE_VERSION,
  storedDecision,
  type ConsentDecision,
} from "@/domain/tracking/replay";
import { visitToken } from "./tracking-client";

/** Shown once the visitor has been reading for a moment, never on arrival. */
const ASK_AFTER_MS = 8_000;

type Phase = "waiting" | "asking" | "recording" | "done";

function remember(decision: "given" | "denied") {
  try {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ v: REPLAY_NOTICE_VERSION, d: decision }),
    );
  } catch {
    // Storage blocked: the visitor is simply asked again next time.
  }
}

function recall(): "given" | "denied" | null {
  try {
    return storedDecision(localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

async function send(decision: ConsentDecision): Promise<string | null> {
  const token = await visitToken();
  if (!token) return null;
  const response = await fetch("/t/consent", {
    method: "POST",
    body: JSON.stringify({ token, decision, version: REPLAY_NOTICE_VERSION }),
    headers: { "content-type": "application/json" },
  }).catch(() => null);
  return response?.ok ? token : null;
}

const button =
  "inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The replay notice (§9 „kleiner, ehrlicher Hinweis“): two equal buttons,
 * nothing recorded before „Ja“. The device remembers only the decision.
 */
export function ReplayConsent({ privacyHref }: { privacyHref: string }) {
  // "waiting" and "done" both render nothing, so reading storage here is hydration-safe.
  const [phase, setPhase] = useState<Phase>(() =>
    typeof window !== "undefined" && recall() === "denied" ? "done" : "waiting",
  );
  const stop = useRef<(() => void) | null>(null);

  const record = async (decision: "given") => {
    const token = await send(decision);
    if (!token) {
      setPhase("done");
      return;
    }
    const { startRecording } = await import("./replay-recorder");
    stop.current = await startRecording(token);
    setPhase("recording");
  };

  useEffect(() => {
    const known = recall();
    if (known === "denied") return;
    if (known === "given") {
      // record() only sets state after its network round trips, never synchronously.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void record("given");
      return () => stop.current?.();
    }
    const timer = window.setTimeout(() => setPhase("asking"), ASK_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      stop.current?.();
    };
  }, []);

  if (phase === "asking") {
    return (
      <section
        aria-labelledby="replay-consent-title"
        data-replay-block
        className="fixed inset-x-3 top-3 z-50 rounded-2xl border border-border bg-surface p-4 shadow-lg md:inset-x-auto md:top-auto md:bottom-4 md:left-4 md:w-[24rem] print:hidden"
      >
        <h2 id="replay-consent-title" className="text-sm font-semibold">
          {REPLAY_NOTICE.title}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">
          {REPLAY_NOTICE.body}{" "}
          <a href={privacyHref} className="underline underline-offset-2">
            Datenschutz
          </a>
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={button}
            onClick={() => {
              remember("given");
              void record("given");
            }}
          >
            {REPLAY_NOTICE.accept}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              remember("denied");
              setPhase("done");
              void send("denied");
            }}
          >
            {REPLAY_NOTICE.decline}
          </button>
        </div>
      </section>
    );
  }
  if (phase === "recording") {
    return (
      <div
        data-replay-block
        className="fixed bottom-24 left-3 z-30 md:bottom-4 md:left-4 print:hidden"
      >
        <button
          type="button"
          onClick={() => {
            stop.current?.();
            remember("denied");
            setPhase("done");
            void send("withdrawn");
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface/95 px-4 text-xs text-foreground-muted shadow-sm backdrop-blur hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <span aria-hidden className="size-2 rounded-full bg-danger" />
          Aufzeichnung läuft · beenden
        </button>
      </div>
    );
  }
  return null;
}
