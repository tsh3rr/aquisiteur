"use client";

import { useId, useState } from "react";
import { Picture } from "../picture";
import type { ResolvedImage } from "../render-context";

/**
 * Comparison slider (§7.2): the "after" image is revealed with a clip-path
 * driven by a native range input, so it works with keyboard, touch and
 * screen readers. Without JS it shows a 50/50 split.
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
  const id = useId();
  return (
    <figure className="grid gap-3">
      <div className="relative overflow-hidden rounded-xl shadow-lg ring-1 ring-border select-none has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-focus-ring">
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
          <span className="absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#fff] text-[#171717] shadow-lg">
            ⇆
          </span>
        </div>
        <span
          aria-hidden
          className="absolute bottom-3 left-3 rounded-full bg-[#000]/70 px-3 py-1 text-sm font-medium text-[#fff]"
        >
          {beforeLabel}
        </span>
        <span
          aria-hidden
          className="absolute right-3 bottom-3 rounded-full bg-[#000]/70 px-3 py-1 text-sm font-medium text-[#fff]"
        >
          {afterLabel}
        </span>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          aria-label={`Vergleich ${beforeLabel} und ${afterLabel}`}
          aria-valuetext={`${100 - position} % ${afterLabel} sichtbar`}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0 focus-visible:opacity-0"
        />
      </div>
      <figcaption className="text-sm text-foreground-muted">
        Regler ziehen oder mit den Pfeiltasten verschieben. Links {beforeLabel.toLowerCase()},
        rechts {afterLabel.toLowerCase()}.
      </figcaption>
    </figure>
  );
}
