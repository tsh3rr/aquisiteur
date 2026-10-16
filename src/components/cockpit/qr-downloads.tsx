"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const DPI = 300;
const MM_PER_INCH = 25.4;

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Adds a pHYs chunk after IHDR, so print programs place the PNG at 300 dpi. */
function withDpi(png: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  const perMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const ihdrEnd = 8 + 25;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd));
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function svgToPng(svgText: string): Promise<Blob> {
  const widthMm = Number(/width="([\d.]+)mm"/.exec(svgText)?.[1] ?? 30);
  const heightMm = Number(/height="([\d.]+)mm"/.exec(svgText)?.[1] ?? 30);
  const width = Math.round((widthMm / MM_PER_INCH) * DPI);
  const height = Math.round((heightMm / MM_PER_INCH) * DPI);
  const sized = svgText
    .replace(/width="[\d.]+mm"/, `width="${width}"`)
    .replace(/height="[\d.]+mm"/, `height="${height}"`);
  const image = new Image();
  image.src = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(image.src);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("png");
  return new Blob([withDpi(new Uint8Array(await blob.arrayBuffer()), DPI)], {
    type: "image/png",
  });
}

/** SVG and 300-dpi PNG downloads of a touchpoint's QR code (§6.2). */
export function QrDownloads({ href, name, label }: { href: string; name: string; label: string }) {
  const [message, setMessage] = useState("");
  const download = async (framed: boolean, format: "svg" | "png") => {
    setMessage("");
    try {
      const response = await fetch(`${href}${framed ? "?rahmen=1" : ""}`);
      if (!response.ok) throw new Error(String(response.status));
      const svg = await response.text();
      const file = `${name}${framed ? "-rahmen" : ""}.${format}`;
      save(
        format === "svg" ? new Blob([svg], { type: "image/svg+xml" }) : await svgToPng(svg),
        file,
      );
      setMessage(`${file} heruntergeladen.`);
    } catch {
      setMessage("Download fehlgeschlagen. Bitte erneut versuchen.");
    }
  };
  const options = [
    { framed: false, format: "svg", text: "SVG" },
    { framed: false, format: "png", text: "PNG" },
    { framed: true, format: "svg", text: "SVG mit Rahmen" },
    { framed: true, format: "png", text: "PNG mit Rahmen" },
  ] as const;
  return (
    <div className="grid gap-1">
      <div
        role="group"
        aria-label={`QR-Code „${label}“ herunterladen`}
        className="flex flex-wrap gap-1.5"
      >
        {options.map((option) => (
          <Button
            key={option.text}
            variant="secondary"
            size="sm"
            onClick={() => void download(option.framed, option.format)}
          >
            <Download aria-hidden />
            {option.text}
          </Button>
        ))}
      </div>
      <p aria-live="polite" className="text-xs text-foreground-muted empty:hidden">
        {message}
      </p>
    </div>
  );
}
