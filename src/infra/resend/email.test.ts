import { describe, expect, it, vi } from "vitest";
import { resendEmail } from "./email";

describe("resendEmail", () => {
  it("posts the message to the Resend API", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "mail-1" }));
    const port = resendEmail("re_key", "Aquisiteur <a@b.de>", fetcher as typeof fetch);
    const result = await port.send({ to: "x@y.de", subject: "Hallo", text: "T", html: "<p>T</p>" });
    expect(result).toEqual({ id: "mail-1" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer re_key");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Aquisiteur <a@b.de>",
      to: "x@y.de",
      subject: "Hallo",
      html: "<p>T</p>",
      text: "T",
    });
  });

  it("throws with Resend's error message", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ message: "Domain not verified" }, { status: 403 }),
    );
    const port = resendEmail("re_key", "a@b.de", fetcher as typeof fetch);
    await expect(port.send({ to: "x@y.de", subject: "S", text: "T", html: "" })).rejects.toThrow(
      "Resend error: Domain not verified",
    );
  });

  it("sends headers and attachments as base64", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "mail-2" }));
    const port = resendEmail("re_key", "a@b.de", fetcher as typeof fetch);
    await port.send({
      to: "x@y.de",
      subject: "Rechnung",
      text: "T",
      html: "",
      replyTo: "owner@studio.test",
      headers: { "Message-ID": "<1@b.de>" },
      attachments: [
        {
          filename: "RE-2026-0001.pdf",
          content: new TextEncoder().encode("%PDF-1.7"),
          contentType: "application/pdf",
        },
      ],
    });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      reply_to: "owner@studio.test",
      headers: { "Message-ID": "<1@b.de>" },
      attachments: [
        {
          filename: "RE-2026-0001.pdf",
          content: btoa("%PDF-1.7"),
          content_type: "application/pdf",
        },
      ],
    });
  });
});
