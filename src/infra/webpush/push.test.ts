import { describe, expect, it } from "vitest";
import { b64url, encryptPayload, fromB64url, vapidAuthorization } from "./push";

/** RFC 8291, appendix A. */
const rfc = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("Web Push encryption", () => {
  it("matches the RFC 8291 test vector", async () => {
    const body = await encryptPayload(
      { p256dh: rfc.uaPublic, auth: rfc.auth },
      new TextEncoder().encode(rfc.plaintext),
      {
        senderPrivateKey: rfc.asPrivate,
        senderPublicKey: rfc.asPublic,
        salt: fromB64url(rfc.salt),
      },
    );
    expect(b64url(body)).toBe(rfc.body);
  });

  it("uses a fresh key and salt for every message", async () => {
    const keys = { p256dh: rfc.uaPublic, auth: rfc.auth };
    const a = await encryptPayload(keys, new TextEncoder().encode("x"));
    const b = await encryptPayload(keys, new TextEncoder().encode("x"));
    expect(b64url(a)).not.toBe(b64url(b));
    expect(a.length).toBe(16 + 4 + 1 + 65 + 1 + 1 + 16);
  });
});

describe("VAPID", () => {
  it("signs a JWT for the push service origin", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!;
    const header = await vapidAuthorization(
      { publicKey, privateKey, subject: "mailto:owner@example.com" },
      "https://fcm.googleapis.com/fcm/send/abc",
      Date.UTC(2026, 9, 16),
    );
    const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(key).toBe(publicKey);
    const [h, c, s] = token!.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c!)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Date.UTC(2026, 9, 16) / 1000 + 12 * 60 * 60,
      sub: "mailto:owner@example.com",
    });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      fromB64url(s!),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(valid).toBe(true);
  });
});
