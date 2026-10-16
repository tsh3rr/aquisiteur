import { describe, expect, it } from "vitest";
import { readBodyLimited, readTextLimited } from "./body";

function chunked(parts: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Request("https://x.test/", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("readBodyLimited", () => {
  it("reads a body within the limit", async () => {
    expect(await readTextLimited(chunked(['{"a":', "1}"]), 100)).toBe('{"a":1}');
  });

  it("stops a chunked body without Content-Length once it is too large", async () => {
    expect(await readBodyLimited(chunked(["x".repeat(60), "y".repeat(60)]), 100)).toBeNull();
  });

  it("refuses early when Content-Length is already too large", async () => {
    const request = new Request("https://x.test/", {
      method: "POST",
      body: "small",
      headers: { "content-length": "5000" },
    });
    expect(await readBodyLimited(request, 100)).toBeNull();
  });
});
