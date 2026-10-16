import type { StoragePort } from "../types";

/**
 * Development and test adapter: files in a local folder (default
 * .data/storage). Node only; production uses the S3 adapter.
 */
export function localStorage(root: string): StoragePort {
  const resolve = async (key: string) => {
    const path = await import("node:path");
    const base = path.resolve(root);
    const full = path.resolve(base, key);
    if (!full.startsWith(`${base}${path.sep}`)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  };
  const metaPath = (file: string) => `${file}.meta.json`;

  return {
    async put(key, body, options) {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const file = await resolve(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body);
      await fs.writeFile(metaPath(file), JSON.stringify({ contentType: options.contentType }));
    },
    async get(key) {
      const fs = await import("node:fs/promises");
      const file = await resolve(key);
      try {
        const [data, meta] = await Promise.all([
          fs.readFile(file),
          fs.readFile(metaPath(file), "utf8"),
        ]);
        const { contentType } = JSON.parse(meta) as { contentType: string };
        return { body: new Blob([data]).stream(), contentType, size: data.byteLength };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      const fs = await import("node:fs/promises");
      const file = await resolve(key);
      await fs.rm(file, { force: true });
      await fs.rm(metaPath(file), { force: true });
    },
    async deletePrefix(prefix) {
      if (!prefix.endsWith("/")) throw new Error(`Storage prefix must end in "/": ${prefix}`);
      const fs = await import("node:fs/promises");
      const dir = await resolve(prefix.slice(0, -1));
      const entries = await fs
        .readdir(dir, { recursive: true, withFileTypes: true })
        .catch(() => []);
      const count = entries.filter((e) => e.isFile() && !e.name.endsWith(".meta.json")).length;
      await fs.rm(dir, { recursive: true, force: true });
      return count;
    },
  };
}
