import { describe, expect, it } from "vitest";
import { domainOf, messageIdFor, nextEmailStatus, senderAddress } from "./email";

describe("outgoing mail", () => {
  it("moves a status forward only", () => {
    expect(nextEmailStatus("sending", "sent")).toBe("sent");
    expect(nextEmailStatus("sent", "delivered")).toBe("delivered");
    expect(nextEmailStatus("delivered", "sent")).toBeNull();
    expect(nextEmailStatus("delivered", "delivered")).toBeNull();
    expect(nextEmailStatus("delivered", "bounced")).toBe("bounced");
    expect(nextEmailStatus("bounced", "delivered")).toBeNull();
    expect(nextEmailStatus("bounced", "failed")).toBeNull();
  });

  it("names the agency as sender on the platform's address", () => {
    expect(senderAddress('Studio "M" <Web>', "Aquisiteur <rechnung@mail.aquisiteur.app>")).toBe(
      '"Studio M Web" <rechnung@mail.aquisiteur.app>',
    );
    expect(senderAddress("", "noreply@x.de")).toBe("noreply@x.de");
  });

  it("builds a Message-ID on the sending domain", () => {
    expect(domainOf("Aquisiteur <noreply@Mail.Example.com>")).toBe("mail.example.com");
    expect(domainOf("kaputt")).toBeNull();
    expect(messageIdFor("abc", "mail.example.com")).toBe("<abc@mail.example.com>");
  });
});
