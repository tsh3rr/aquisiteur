import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, importSecretKey, sha256Hex } from "./crypto";

const keyB64 = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));

describe("integration secret encryption", () => {
  it("round-trips and uses a fresh IV each time", async () => {
    const key = await importSecretKey(keyB64);
    const a = await encryptSecret(key, "pingen-api-key", "ws1:pingen");
    const b = await encryptSecret(key, "pingen-api-key", "ws1:pingen");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(await decryptSecret(key, a, "ws1:pingen")).toBe("pingen-api-key");
  });

  it("refuses ciphertext moved to another workspace", async () => {
    const key = await importSecretKey(keyB64);
    const sealed = await encryptSecret(key, "secret", "ws1:pingen");
    await expect(decryptSecret(key, sealed, "ws2:pingen")).rejects.toThrow();
  });

  it("rejects keys of the wrong size", async () => {
    await expect(importSecretKey(btoa("short"))).rejects.toThrow(/32 bytes/);
  });
});

describe("sha256Hex()", () => {
  it("matches the known digest", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
