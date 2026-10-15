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
  };
}
