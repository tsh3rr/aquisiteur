import { AwsClient } from "aws4fetch";
import type { StoragePort } from "../types";

/**
 * Any S3-compatible bucket; in production Cloudflare R2 through its S3 API
 * (§5: "R2 heute, morgen jeder S3-kompatible Speicher"). Path-style URLs so
 * MinIO and others work unchanged. aws4fetch signs with WebCrypto, so this
 * adapter runs on Workers and Node alike.
 */
export function s3Storage(config: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}): StoragePort {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
  });
  const base = `${config.endpoint.replace(/\/$/, "")}/${encodeURIComponent(config.bucket)}`;
  const url = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

  return {
    async put(key, body, options) {
      const response = await client.fetch(url(key), {
        method: "PUT",
        body: body as Uint8Array<ArrayBuffer>,
        headers: {
          "content-type": options.contentType,
          ...(options.cacheControl ? { "cache-control": options.cacheControl } : {}),
        },
      });
      if (!response.ok) {
        throw new Error(`Storage PUT ${key} failed: ${response.status} ${await response.text()}`);
      }
    },
    async get(key) {
      const response = await client.fetch(url(key), { method: "GET" });
      if (response.status === 404) return null;
      if (!response.ok || !response.body) {
        throw new Error(`Storage GET ${key} failed: ${response.status}`);
      }
      return {
        body: response.body,
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        size: Number(response.headers.get("content-length") ?? 0),
      };
    },
    async delete(key) {
      const response = await client.fetch(url(key), { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Storage DELETE ${key} failed: ${response.status}`);
      }
    },
    async deletePrefix(prefix) {
      if (!prefix.endsWith("/")) throw new Error(`Storage prefix must end in "/": ${prefix}`);
      let removed = 0;
      let token: string | undefined;
      do {
        const query = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
        if (token) query.set("continuation-token", token);
        const response = await client.fetch(`${base}?${query}`, { method: "GET" });
        if (!response.ok) throw new Error(`Storage LIST ${prefix} failed: ${response.status}`);
        const xml = await response.text();
        const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => decodeXml(m[1]!));
        for (const key of keys) await this.delete(key);
        removed += keys.length;
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? decodeXml(
              /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "",
            )
          : undefined;
      } while (token);
      return removed;
    },
  };
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
