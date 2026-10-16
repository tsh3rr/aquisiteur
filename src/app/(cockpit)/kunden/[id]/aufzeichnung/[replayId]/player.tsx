"use client";

import "rrweb/dist/style.css";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Replayer } from "rrweb";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/misc";
import { formatSeconds } from "@/domain/analytics/format";

const SPEEDS = [1, 2, 4, 8] as const;

/** Plays one recording (rrweb) inside a sandboxed frame, scaled to fit. */
export function ReplayPlayer({ src }: { src: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const replayer = useRef<Replayer | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "empty">("loading");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [skipInactive, setSkipInactive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let observer: ResizeObserver | null = null;
    (async () => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(String(response.status));
      const events = (await response.json()) as { type: number; timestamp: number }[];
      if (cancelled) return;
      if (events.length < 2) {
        setState("empty");
        return;
      }
      const { Replayer } = await import("rrweb");
      if (cancelled || !holder.current) return;
      const instance = new Replayer(events as never, {
        root: holder.current,
        skipInactive: true,
        mouseTail: false,
        showWarning: false,
      });
      replayer.current = instance;
      const frame = holder.current.querySelector("iframe");
      if (frame) {
        frame.title = "Wiedergabe des aufgezeichneten Besuchs";
        // A picture of the visit, not something to interact with.
        frame.tabIndex = -1;
      }
      setTotal(instance.getMetaData().totalTime);
      instance.on("finish", () => setPlaying(false));
      const fit = () => {
        const frame = holder.current?.querySelector("iframe");
        const wrapper = holder.current?.querySelector<HTMLElement>(".replayer-wrapper");
        if (!frame || !wrapper || !stage.current) return;
        const width = Number(frame.getAttribute("width")) || frame.offsetWidth;
        const height = Number(frame.getAttribute("height")) || frame.offsetHeight;
        const scale = Math.min(1, stage.current.clientWidth / width);
        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.transformOrigin = "top left";
        stage.current.style.height = `${height * scale}px`;
      };
      instance.on("resize", fit);
      observer = new ResizeObserver(fit);
      if (stage.current) observer.observe(stage.current);
      instance.pause(0);
      fit();
      timer = window.setInterval(() => setTime(instance.getCurrentTime()), 250);
      setState("ready");
    })().catch(() => {
      if (!cancelled) setState("error");
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      observer?.disconnect();
      replayer.current?.destroy();
      replayer.current = null;
    };
  }, [src]);

  const toggle = () => {
    const instance = replayer.current;
    if (!instance) return;
    if (playing) {
      instance.pause();
      setPlaying(false);
    } else {
      instance.play(time >= total ? 0 : time);
      setPlaying(true);
    }
  };

  const seek = (value: number) => {
    const instance = replayer.current;
    if (!instance) return;
    setTime(value);
    if (playing) instance.play(value);
    else instance.pause(value);
  };

  return (
    <div className="grid gap-4" aria-busy={state === "loading"}>
      {state === "error" ? (
        <Alert tone="danger">Die Aufzeichnung konnte nicht geladen werden.</Alert>
      ) : null}
      {state === "empty" ? (
        <Alert tone="info">Diese Aufzeichnung ist zu kurz zum Abspielen.</Alert>
      ) : null}
      <div
        ref={stage}
        className="relative min-h-64 overflow-hidden rounded-lg border border-border bg-surface-sunken"
      >
        {state === "loading" ? <Skeleton className="absolute inset-0" /> : null}
        <div ref={holder} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={toggle} disabled={state !== "ready"}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          {playing ? "Pause" : "Abspielen"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => seek(0)} disabled={state !== "ready"}>
          <RotateCcw aria-hidden />
          Von vorn
        </Button>
        <label className="flex min-w-48 flex-1 items-center gap-3 text-sm">
          <span className="sr-only">Position</span>
          <input
            type="range"
            min={0}
            max={Math.max(total, 1)}
            step={250}
            value={Math.min(time, total)}
            onChange={(event) => seek(Number(event.target.value))}
            disabled={state !== "ready"}
            aria-valuetext={`${formatSeconds(time / 1000)} von ${formatSeconds(total / 1000)}`}
            className="h-11 flex-1 accent-accent"
          />
          <span className="text-foreground-muted tabular-nums" aria-hidden>
            {formatSeconds(time / 1000)} / {formatSeconds(total / 1000)}
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Tempo
          <select
            value={speed}
            onChange={(event) => {
              const next = Number(event.target.value) as (typeof SPEEDS)[number];
              setSpeed(next);
              replayer.current?.setConfig({ speed: next });
            }}
            className="h-11 rounded-md border border-border-strong bg-surface px-2"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={skipInactive}
            onChange={(event) => {
              setSkipInactive(event.target.checked);
              replayer.current?.setConfig({ skipInactive: event.target.checked });
            }}
            className="size-5 accent-accent"
          />
          Pausen überspringen
        </label>
      </div>
    </div>
  );
}
