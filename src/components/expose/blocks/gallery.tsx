"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Picture } from "../picture";
import type { ResolvedImage } from "../render-context";

/** Thumbnail grid with a lightbox on the native <dialog> (focus trap, Escape, inert background). */
export function MockupGallery({ images }: { images: ResolvedImage[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const current = images[index];

  const open = (next: number) => {
    setIndex(next);
    dialog.current?.showModal();
  };
  const step = (delta: number) => setIndex((i) => (i + delta + images.length) % images.length);
  const count = images.length;

  // Arrow keys browse, a click on the backdrop closes. Escape is native.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setIndex((i) => (i + 1) % count);
      if (event.key === "ArrowLeft") setIndex((i) => (i - 1 + count) % count);
    };
    const onClick = (event: MouseEvent) => {
      if (event.target === element) element.close();
    };
    element.addEventListener("keydown", onKey);
    element.addEventListener("click", onClick);
    return () => {
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("click", onClick);
    };
  }, [count]);

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2">
        {images.map((image, i) => (
          <li key={image.src}>
            <figure className="grid gap-2">
              <button
                type="button"
                onClick={() => open(i)}
                className="group overflow-hidden rounded-xl shadow-md ring-1 ring-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                aria-label={`Vergrößern: ${image.alt || image.caption || `Bild ${i + 1}`}`}
              >
                <Picture
                  image={image}
                  sizes="(min-width: 640px) 50vw, 100vw"
                  imgClassName="transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
                />
              </button>
              {image.caption ? (
                <figcaption className="text-sm text-foreground-muted">{image.caption}</figcaption>
              ) : null}
            </figure>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        aria-label="Bildansicht"
        className="backdrop:bg-black/80 m-auto max-h-[92dvh] w-[min(92vw,80rem)] overflow-visible bg-transparent p-0"
      >
        {current ? (
          <figure className="grid gap-3">
            <Picture
              image={current}
              sizes="92vw"
              imgClassName="max-h-[80dvh] w-auto mx-auto rounded-lg object-contain"
            />
            <figcaption className="text-white text-center">
              {current.caption ?? current.alt}
              <span className="text-white/70 ml-2">
                {index + 1} / {images.length}
              </span>
            </figcaption>
          </figure>
        ) : null}
        <div className="fixed top-4 right-4 flex gap-2">
          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                className="bg-white text-neutral-900 grid size-11 place-items-center rounded-full"
                aria-label="Vorheriges Bild"
              >
                <ChevronLeft aria-hidden className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                className="bg-white text-neutral-900 grid size-11 place-items-center rounded-full"
                aria-label="Nächstes Bild"
              >
                <ChevronRight aria-hidden className="size-5" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="bg-white text-neutral-900 grid size-11 place-items-center rounded-full"
            aria-label="Schließen"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
      </dialog>
    </>
  );
}
