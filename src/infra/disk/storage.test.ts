import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diskStorage } from "./storage";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aquisiteur-storage-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe("diskStorage", () => {
  it("stores, reads and deletes a file with its content type", async () => {
    const storage = diskStorage(root);
    await storage.put("ws-1/exposes/a.avif", bytes("image"), { contentType: "image/avif" });

    const file = await storage.get("ws-1/exposes/a.avif");
    expect(file?.contentType).toBe("image/avif");
    expect(file?.size).toBe(5);
    expect(await new Response(file!.body).text()).toBe("image");

    await storage.delete("ws-1/exposes/a.avif");
    expect(await storage.get("ws-1/exposes/a.avif")).toBeNull();
  });

  it("replaces a file without leaving temporary files behind", async () => {
    const storage = diskStorage(root);
    await storage.put("ws-1/a.txt", bytes("one"), { contentType: "text/plain" });
    await storage.put("ws-1/a.txt", bytes("two"), { contentType: "text/plain" });

    expect(await new Response((await storage.get("ws-1/a.txt"))!.body).text()).toBe("two");
    expect((await readdir(join(root, "ws-1"))).sort()).toEqual(["a.txt", "a.txt.meta.json"]);
  });

  it("deletes everything under a workspace prefix and counts the files", async () => {
    const storage = diskStorage(root);
    await storage.put("ws-1/a.txt", bytes("a"), { contentType: "text/plain" });
    await storage.put("ws-1/replays/b.json", bytes("b"), { contentType: "application/json" });
    await storage.put("ws-2/c.txt", bytes("c"), { contentType: "text/plain" });

    expect(await storage.deletePrefix("ws-1/")).toBe(2);
    expect(await storage.get("ws-1/a.txt")).toBeNull();
    expect(await storage.get("ws-2/c.txt")).not.toBeNull();
  });

  it("refuses keys that leave the storage folder", async () => {
    const storage = diskStorage(root);
    await expect(
      storage.put("../outside.txt", bytes("x"), { contentType: "text/plain" }),
    ).rejects.toThrow("Invalid storage key");
    await expect(storage.deletePrefix("ws-1")).rejects.toThrow('must end in "/"');
  });
});
