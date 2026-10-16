/**
 * Reads a request body up to `maxBytes` and stops as soon as it is larger
 * (§10 „Größenlimits“). The Content-Length header alone is not enough: a
 * chunked request has none. Returns null when the body is too large.
 */
export async function readBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** UTF-8 text of a body of at most `maxBytes`, or null. */
export async function readTextLimited(request: Request, maxBytes: number): Promise<string | null> {
  const body = await readBodyLimited(request, maxBytes);
  return body ? new TextDecoder().decode(body) : null;
}
