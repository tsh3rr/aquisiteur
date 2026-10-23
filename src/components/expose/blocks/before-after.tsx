"use client";

import { ChevronsLeftRight } from "lucide-react";
import { useId, useRef, useState, type PointerEvent } from "react";
import { Picture } from "../picture";
import type { ResolvedImage } from "../render-context";

/** Horizontal travel before a touch that started away from the divider counts as a drag. */
const TOUCH_DRAG_THRESHOLD_PX = 8;

/**
 * Comparison slider (§7.2): the "after" image is revealed with a clip-path.
 * A native range input carries keyboard and screen-reader access; pointers
 * drag anywhere on the image (mouse jumps to the click, touch follows a
 * horizontal swipe so vertical page scrolling keeps working). Without JS it
 * shows a 50/50 split.
 */
export function BeforeAfterSlider({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: ResolvedImage;
  after: ResolvedImage;
  beforeLabel: string;
  afterLabel: string;
}) {
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  /** Where a touch began, until it turns into a horizontal drag. */
  const pending = useRef<{ x: number; y: number } | null>(null);

  const moveTo = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const percent = ((event.clientX - box.left) / box.width) * 100;
    setPosition(Math.round(Math.min(100, Math.max(0, percent))));
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    pending.current = null;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    input.current?.focus({ preventScroll: true });
    moveTo(event);
  };

  return (
    <figure className="grid gap-3">
      <div
        className="relative cursor-ew-resize touch-pan-y overflow-hidden rounded-xl shadow-lg ring-1 ring-border select-none has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-focus-ring"
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          if (event.pointerType === "mouse") {
            event.preventDefault();
            startDrag(event);
          } else {
            pending.current = { x: event.clientX, y: event.clientY };
          }
        }}
        onPointerMove={(event) => {
          if (dragging) {
            moveTo(event);
            return;
          }
          const start = pending.current;
          if (!start) return;
          const dx = Math.abs(event.clientX - start.x);
          const dy = Math.abs(event.clientY - start.y);
          if (dx >= TOUCH_DRAG_THRESHOLD_PX && dx > dy) startDrag(event);
          else if (dy >= TOUCH_DRAG_THRESHOLD_PX) pending.current = null;
        }}
        onPointerUp={(event) => {
          // A tap without a swipe jumps there, like a mouse click.
          if (pending.current) startDrag(event);
          setDragging(false);
          pending.current = null;
        }}
        onPointerCancel={() => {
          setDragging(false);
          pending.current = null;
        }}
      >
        <Picture image={before} sizes="(min-width: 1024px) 960px, 100vw" />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${position}%)` }}>
          <Picture
            image={after}
            sizes="(min-width: 1024px) 960px, 100vw"
            sizing="h-full w-full"
            imgClassName="object-cover"
          />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-[#fff] shadow-[0_0_0_1px_rgb(0_0_0/0.2)]"
          style={{ left: `${position}%` }}
        >
          <span
            data-handle
            data-dragging={dragging || undefined}
            className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-[#171717] bg-[#fff] text-[#171717] shadow-lg ring-4 ring-[#fff]/60 transition-transform data-dragging:scale-110 motion-reduce:transition-none"
          >
            <ChevronsLeftRight aria-hidden className="size-6" strokeWidth={2.25} />
          </span>
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-[#000]/70 px-3 py-1 text-sm font-medium text-[#fff]"
        >
          {beforeLabel}
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-[#000]/70 px-3 py-1 text-sm font-medium text-[#fff]"
        >
          {afterLabel}
        </span>
        <input
          ref={input}
          id={id}
          type="range"
          min={0}
          max={100}
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          aria-label={`Vergleich ${beforeLabel} und ${afterLabel}`}
          aria-valuetext={`${100 - position} % ${afterLabel} sichtbar`}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0 focus-visible:opacity-0"
        />
      </div>
      <figcaption className="text-sm text-foreground-muted">
        Irgendwo im Bild ziehen oder mit den Pfeiltasten verschieben. Links{" "}
        {beforeLabel.toLowerCase()}, rechts {afterLabel.toLowerCase()}.
      </figcaption>
    </figure>
  );
}
