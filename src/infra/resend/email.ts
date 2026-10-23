import type { EmailPort } from "../types";

/**
 * Resend over its REST API with plain fetch. The SDK pulled ~400 KB of
 * parsers and webhook code into every route chunk of the Worker (ADR-0035).
 */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function resendEmail(
  apiKey: string,
  defaultFrom: string,
  fetcher: typeof fetch = fetch,
): EmailPort {
  return {
    async send(message) {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: message.from ?? defaultFrom,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          ...(message.headers ? { headers: message.headers } : {}),
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((file) => ({
                  filename: file.filename,
                  content: base64(file.content),
                  content_type: file.contentType,
                })),
              }
            : {}),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(`Resend error: ${data?.message ?? `HTTP ${response.status}`}`);
      }
      return { id: data?.id ?? null };
    },
  };
}
