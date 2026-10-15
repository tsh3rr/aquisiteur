import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import sharp from "sharp";
import {
  assetKindForPath,
  IMAGE_WIDTHS,
  MAX_BYTES,
  type VariantFormat,
} from "../../src/domain/expose/asset-files";
import {
  collectAssetPaths,
  validateExpose,
  type ExposeDocument,
  type ValidationIssue,
} from "../../src/domain/expose/schema";
import type { PublishFile } from "../../src/server/exposes/publish";

/**
 * Reads an exposé folder (expose.json + assets/), validates it and, for
 * publishing, renders every image to AVIF and WebP in several widths with
 * sharp (§5: optimisation at publish time, never at runtime). Metadata such
 * as EXIF/GPS is stripped by sharp.
 */
export interface LoadedExpose {
  document: ExposeDocument;
  raw: unknown;
  files: PublishFile[];
  warnings: string[];
}

export type LoadResult =
  { ok: true; expose: LoadedExpose } | { ok: false; issues: ValidationIssue[] };

const AVIF = { quality: 55, effort: 4 } as const;
const WEBP = { quality: 78, effort: 4 } as const;

export async function loadExposeFolder(
  dir: string,
  options: { optimize: boolean },
): Promise<LoadResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, "expose.json"), "utf8"));
  } catch (error) {
    const message =
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "expose.json nicht gefunden."
        : `Kein gültiges JSON: ${(error as Error).message}`;
    return { ok: false, issues: [{ path: "expose.json", message }] };
  }

  const validation = validateExpose(raw);
  if (!validation.ok) return { ok: false, issues: validation.issues };
  const document = validation.document;

  const root = await realpath(dir);
  const issues: ValidationIssue[] = [];
  const warnings: string[] = [];
  const files: PublishFile[] = [];

  for (const path of collectAssetPaths(document)) {
    let bytes: Buffer;
    try {
      const full = await realpath(join(root, path));
      if (!full.startsWith(`${root}${sep}`)) throw new Error("outside");
      if (!(await stat(full)).isFile()) throw new Error("not a file");
      bytes = await readFile(full);
    } catch {
      issues.push({ path, message: "Datei nicht gefunden (relativ zum Exposé-Ordner)." });
      continue;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const kind = assetKindForPath(path);

    if (kind === "image") {
      try {
        files.push(await processImage(path, sha256, bytes, options.optimize));
      } catch (error) {
        issues.push({
          path,
          message: `Bild kann nicht gelesen werden: ${(error as Error).message}`,
        });
      }
      continue;
    }

    if (bytes.byteLength > MAX_BYTES[kind]) {
      issues.push({
        path,
        message: `Datei ist größer als ${Math.round(MAX_BYTES[kind] / 1024 / 1024)} MB.`,
      });
      continue;
    }
    if (kind === "captions" && !bytes.toString("utf8").replace(/^﻿/, "").startsWith("WEBVTT")) {
      issues.push({
        path,
        message: "Untertitel müssen im WebVTT-Format sein (beginnen mit WEBVTT).",
      });
      continue;
    }
    const format = path.split(".").pop()!.toLowerCase() as VariantFormat;
    files.push({
      path,
      sha256,
      width: null,
      height: null,
      variants: [{ format, width: null, height: null, data: new Uint8Array(bytes) }],
    });
  }

  if (issues.length > 0) return { ok: false, issues };

  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const block of document.blocks) {
    if (block.type === "before_after") {
      const before = byPath.get(block.before.src);
      const after = byPath.get(block.after.src);
      if (before?.width && before.height && after?.width && after.height) {
        const ratio = before.width / before.height / (after.width / after.height);
        if (Math.abs(1 - ratio) > 0.02) {
          warnings.push(
            `Block "${block.id}": Vorher- und Nachher-Bild haben unterschiedliche Seitenverhältnisse.`,
          );
        }
      }
    }
    if (block.type === "mockup_gallery" || block.type === "before_after") {
      const images = block.type === "before_after" ? [block.before, block.after] : block.images;
      for (const image of images) {
        if (!image.alt)
          warnings.push(`Block "${block.id}": ${image.src} hat keinen Alternativtext.`);
      }
    }
  }
  for (const file of files) {
    if (file.width && file.width < 960 && !file.path.endsWith(".svg")) {
      warnings.push(
        `${file.path} ist nur ${file.width} px breit und wirkt auf großen Bildschirmen unscharf.`,
      );
    }
  }

  return { ok: true, expose: { document, raw, files, warnings } };
}

async function processImage(
  path: string,
  sha256: string,
  bytes: Buffer,
  optimize: boolean,
): Promise<PublishFile> {
  const isSvg = path.toLowerCase().endsWith(".svg");
  let input = sharp(bytes, { failOn: "error" });
  let meta = await input.metadata();
  const largest = Math.max(...IMAGE_WIDTHS);
  if (isSvg && meta.width && meta.width < largest) {
    // Vector input: rasterise sharp enough for the largest rendition.
    const scale = Math.min(8, Math.ceil(largest / meta.width));
    input = sharp(bytes, { density: 72 * scale });
    meta = await input.metadata();
  }
  const oriented = (meta.orientation ?? 1) >= 5;
  const width = oriented ? meta.height : meta.width;
  const height = oriented ? meta.width : meta.height;
  if (!width || !height) throw new Error("keine Bildmaße");

  const widths: number[] = IMAGE_WIDTHS.filter((candidate) => candidate < width);
  if (widths.length < IMAGE_WIDTHS.length) widths.push(Math.min(width, largest));

  const file: PublishFile = { path, sha256, width, height, variants: [] };
  for (const target of widths) {
    const targetHeight = Math.round((height * target) / width);
    if (!optimize) {
      file.variants.push({ format: "avif", width: target, height: targetHeight });
      file.variants.push({ format: "webp", width: target, height: targetHeight });
      continue;
    }
    const resized = input.clone().rotate().resize({ width: target, withoutEnlargement: true });
    const [avif, webp] = await Promise.all([
      resized.clone().avif(AVIF).toBuffer(),
      resized.clone().webp(WEBP).toBuffer(),
    ]);
    file.variants.push({
      format: "avif",
      width: target,
      height: targetHeight,
      data: new Uint8Array(avif),
    });
    file.variants.push({
      format: "webp",
      width: target,
      height: targetHeight,
      data: new Uint8Array(webp),
    });
  }
  return file;
}
