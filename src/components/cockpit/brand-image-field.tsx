"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { removeBrandImage, uploadBrandImage } from "@/app/(cockpit)/settings/brand-image-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { BrandImageKind, BrandImagePreview } from "@/server/brand-images";

const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/** Square crop for the photo (shown round), original aspect ratio for the logo. */
const SHAPES: Record<BrandImageKind, { widths: number[]; square: boolean; png?: true }> = {
  photo: { widths: [240, 480], square: true },
  logo: { widths: [480, 960], square: false },
  // PNG only: the letter PDF cannot embed WebP.
  signature: { widths: [600], square: false, png: true },
};

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
}

/**
 * Scales the image in the browser so only small renditions travel to the
 * server (Workers have no image library). WebP where the browser can encode
 * it, PNG otherwise; PNG keeps logo transparency too.
 */
async function renditions(file: File, kind: BrandImageKind) {
  const image = await loadImage(file);
  const vector = file.type === "image/svg+xml";
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  if (!naturalWidth || !naturalHeight) throw new Error("no-size");

  const { widths, square } = SHAPES[kind];
  const side = Math.min(naturalWidth, naturalHeight);
  const source = square
    ? {
        x: (naturalWidth - side) / 2,
        y: (naturalHeight - side) / 2,
        width: side,
        height: side,
      }
    : { x: 0, y: 0, width: naturalWidth, height: naturalHeight };
  // Never upscale raster images; vector logos render sharp at any size.
  const limit = vector ? Infinity : source.width;
  const targets = [...new Set(widths.map((width) => Math.min(width, Math.round(limit))))];

  const form = new FormData();
  form.set("kind", kind);
  let largest = { width: 0, height: 0 };
  for (const width of targets) {
    const height = Math.max(1, Math.round((width * source.height) / source.width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no-canvas");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, width, height);
    let blob = SHAPES[kind].png ? null : await toBlob(canvas, "image/webp");
    if (blob?.type !== "image/webp") blob = await toBlob(canvas, "image/png");
    if (!blob) throw new Error("no-blob");
    const format = blob.type === "image/webp" ? "webp" : "png";
    form.append("variant", blob, `${width}.${format}`);
    if (width > largest.width) largest = { width, height };
  }
  form.set("width", String(largest.width));
  form.set("height", String(largest.height));
  return form;
}

export function BrandImageField({
  kind,
  label,
  hint,
  current,
  canEdit = true,
}: {
  kind: BrandImageKind;
  label: string;
  hint: string;
  current: BrandImagePreview | null;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_INPUT_BYTES) {
      setMessage({ tone: "error", text: "Die Datei ist größer als 20 MB." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      let form: FormData;
      try {
        form = await renditions(file, kind);
      } catch {
        setMessage({
          tone: "error",
          text: "Das Bild konnte nicht gelesen werden. Bitte JPG, PNG, WebP oder SVG wählen.",
        });
        return;
      }
      const result = await uploadBrandImage(form);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error ?? "Hochladen fehlgeschlagen." });
        return;
      }
      setMessage({ tone: "ok", text: `${label} gespeichert.` });
      router.refresh();
    });
    if (input.current) input.current.value = "";
  }

  function onRemove() {
    startTransition(async () => {
      const result = await removeBrandImage(kind);
      setMessage(
        result.ok
          ? { tone: "ok", text: `${label} entfernt.` }
          : { tone: "error", text: result.error ?? "Entfernen fehlgeschlagen." },
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden border border-border bg-surface-sunken",
          kind === "photo" ? "size-20 rounded-full" : "h-20 w-40 rounded-md p-2",
        )}
      >
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element -- workspace file, already scaled
          <img
            src={current.src}
            srcSet={current.srcSet || undefined}
            sizes={kind === "photo" ? "80px" : "160px"}
            width={current.width}
            height={current.height}
            alt={`Aktuelles ${label}`}
            className={cn("h-full w-full", kind === "photo" ? "object-cover" : "object-contain")}
          />
        ) : (
          <ImageUp aria-hidden className="size-6 text-foreground-muted" />
        )}
      </div>
      <div className="grid min-w-0 flex-1 basis-52 gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          {label}
        </label>
        <p id={hintId} className="text-sm text-foreground-muted">
          {hint}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              className="sr-only"
              aria-describedby={hintId}
              disabled={pending}
              onChange={(event) => onFile(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              aria-describedby={hintId}
              onClick={() => input.current?.click()}
            >
              <ImageUp aria-hidden />
              {pending
                ? "Wird gespeichert …"
                : current
                  ? `${label} ersetzen`
                  : `${label} hochladen`}
            </Button>
            {current ? (
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onRemove}>
                <Trash2 aria-hidden />
                Entfernen
              </Button>
            ) : null}
          </div>
        ) : null}
        <p
          aria-live="polite"
          className={cn(
            "text-sm",
            message?.tone === "error" ? "text-danger" : "text-foreground-muted",
          )}
        >
          {message?.text}
        </p>
      </div>
    </div>
  );
}
