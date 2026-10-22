import { describe, expect, it } from "vitest";
import { resendWebhook, svixSignature } from "./webhook";

const secret = `whsec_${btoa("0123456789abcdef0123456789abcdef")}`;
const now = new Date("2026-10-22T10:00:00Z");
const timestamp = String(Math.floor(now.getTime() / 1000));

async function signed(body: string, ts = timestamp) {
  const signature = await svixSignature(secret, "msg_1", ts, body);
  const value = btoa(String.fromCharCode(...signature));
  return new Headers({
    "svix-id": "msg_1",
    "svix-timestamp": ts,
    "svix-signature": `v1,bm90IHRoaXMgb25l v1,${value}`,
  });
}

const port = resendWebhook(secret, () => now);

describe("resendWebhook", () => {
  it("reads a signed delivery event", async () => {
    const body = JSON.stringify({
      type: "email.bounced",
      created_at: "2026-10-22T09:59:00.000Z",
      data: { email_id: "re_1", bounce: { message: "Mailbox full" } },
    });
    expect(await port.parse(body, await signed(body))).toEqual([
      {
        providerId: "re_1",
        status: "bounced",
        at: new Date("2026-10-22T09:59:00.000Z"),
        detail: "Mailbox full",
      },
    ]);
  });

  it("ignores event types it does not know, such as inbound mail", async () => {
    const body = JSON.stringify({ type: "email.received", data: { email_id: "re_2" } });
    expect(await port.parse(body, await signed(body))).toEqual([]);
  });

  it("refuses a wrong signature, a changed body and an old timestamp", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_3" } });
    const headers = await signed(body);
    await expect(port.parse(`${body} `, headers)).rejects.toMatchObject({ status: 401 });
    await expect(port.parse(body, new Headers())).rejects.toMatchObject({ status: 401 });
    const old = String(Number(timestamp) - 600);
    await expect(port.parse(body, await signed(body, old))).rejects.toMatchObject({
      status: 401,
    });
  });
});
