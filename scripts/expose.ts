import "dotenv/config";
import { resolve } from "node:path";
import type { PublishResponse } from "../src/domain/expose/wire";
import { loadExposeFolder, type LoadedExpose } from "./lib/expose-folder";

/**
 * Exposé CLI (§7.2), the main way exposés get into Aquisiteur:
 *
 *   pnpm expose:validate exposes/cafe-mueller [weitere Ordner …]
 *   pnpm expose:publish  exposes/cafe-mueller
 *
 * publish needs AQUISITEUR_API_TOKEN (Einstellungen → API-Tokens) and talks
 * to AQUISITEUR_API_URL (default: APP_URL, then http://localhost:3000).
 */

const color = (code: number) => (text: string) =>
  process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
const red = color(31);
const green = color(32);
const yellow = color(33);
const dim = color(2);

async function load(dir: string, optimize: boolean): Promise<LoadedExpose | null> {
  const result = await loadExposeFolder(resolve(dir), { optimize });
  if (!result.ok) {
    console.error(red(`✗ ${dir}: ${result.issues.length} Problem(e)`));
    for (const issue of result.issues)
      console.error(`  ${red("•")} ${issue.path}: ${issue.message}`);
    return null;
  }
  for (const warning of result.expose.warnings) console.warn(`  ${yellow("!")} ${warning}`);
  return result.expose;
}

async function validate(dirs: string[]): Promise<number> {
  let failed = 0;
  for (const dir of dirs) {
    const expose = await load(dir, false);
    if (!expose) {
      failed++;
      continue;
    }
    console.info(
      green(`✓ ${dir}`),
      dim(`(${expose.document.blocks.length} Blöcke, ${expose.files.length} Dateien)`),
    );
  }
  return failed === 0 ? 0 : 1;
}

async function api<T>(base: string, token: string, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, base), {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    const error = body as { error?: string; issues?: { path: string; message: string }[] };
    const lines = [`${response.status} ${error.error ?? response.statusText}`];
    for (const issue of error.issues ?? []) lines.push(`  • ${issue.path}: ${issue.message}`);
    if (response.status === 401) lines.push("  API-Token ungültig, abgelaufen oder widerrufen.");
    throw new Error(lines.join("\n"));
  }
  return body as T;
}

async function publish(dir: string): Promise<number> {
  const token = process.env.AQUISITEUR_API_TOKEN;
  const base = process.env.AQUISITEUR_API_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  if (!token) {
    console.error(
      red("AQUISITEUR_API_TOKEN fehlt. Token im Cockpit unter Einstellungen → API-Tokens anlegen."),
    );
    return 1;
  }
  console.info(dim(`Optimiere Bilder in ${dir} …`));
  const expose = await load(dir, true);
  if (!expose) return 1;

  const { known } = await api<{ known: string[] }>(base, token, "/api/v1/assets/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha256: expose.files.map((file) => file.sha256) }),
  });
  const knownSet = new Set(known);
  let uploaded = 0;
  for (const file of expose.files) {
    if (knownSet.has(file.sha256)) continue;
    const form = new FormData();
    form.set(
      "meta",
      JSON.stringify({
        path: file.path,
        sha256: file.sha256,
        width: file.width,
        height: file.height,
        variants: file.variants.map((variant, index) => ({
          format: variant.format,
          width: variant.width,
          height: variant.height,
          part: `p${index}`,
        })),
      }),
    );
    file.variants.forEach((variant, index) => {
      form.set(
        `p${index}`,
        new Blob([variant.data! as Uint8Array<ArrayBuffer>]),
        `${index}.${variant.format}`,
      );
    });
    await api(base, token, "/api/v1/assets", { method: "POST", body: form });
    knownSet.add(file.sha256);
    uploaded++;
    console.info(dim(`  ↑ ${file.path}`));
  }

  const result = await api<PublishResponse>(base, token, "/api/v1/exposes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      document: expose.raw,
      assets: expose.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    }),
  });
  console.info(
    green(
      `✓ ${result.createdExpose ? "Neues Exposé" : "Neue Version"} veröffentlicht: Version ${result.version}`,
    ),
    dim(`(${uploaded} neue Dateien, Ref ${result.refCode})`),
  );
  console.info(`  Öffentlich: ${result.url}`);
  console.info(`  Cockpit:    ${result.previewUrl}`);
  return 0;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  const dirs = args.filter((arg) => !arg.startsWith("--"));
  if (command === "validate" && dirs.length > 0) return validate(dirs);
  if (command === "publish" && dirs.length === 1) return publish(dirs[0]!);
  console.error("Aufruf: pnpm expose:validate <ordner> [...]  |  pnpm expose:publish <ordner>");
  return 2;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  },
);
