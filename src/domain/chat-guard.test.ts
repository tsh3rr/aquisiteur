import { describe, expect, it } from "vitest";
import {
  DUPLICATE_WINDOW_MS,
  MAX_LINES,
  countLinks,
  messageProblem,
  normalizeMessage,
} from "./chat-guard";

const char = (code: number) => String.fromCodePoint(code);

describe("normalizeMessage", () => {
  it("removes bidi overrides, zero-width and control characters", () => {
    const rlo = char(0x202e);
    const zwsp = char(0x200b);
    const bell = char(0x07);
    expect(normalizeMessage(`Hal${zwsp}lo ${rlo}txt.exe${bell}`)).toBe("Hallo txt.exe");
  });

  it("keeps emoji sequences, umlauts and line breaks", () => {
    const family = `👩${char(0x200d)}👩${char(0x200d)}👧`;
    expect(normalizeMessage(`Grüße ${family}\r\nZeile 2\tEnde`)).toBe(
      `Grüße ${family}\nZeile 2\tEnde`,
    );
  });

  it("composes to NFC and limits blank lines", () => {
    expect(normalizeMessage(`Mu${char(0x308)}ller`)).toBe("Müller");
    expect(normalizeMessage("a\n\n\n\n\n\nb")).toBe("a\n\n\nb");
  });

  it("leaves nothing of a message made of invisible characters", () => {
    expect(normalizeMessage(`${char(0x200b)}${char(0xfeff)} `)).toBe("");
  });
});

describe("countLinks", () => {
  it("counts addresses with scheme, www and bare domains with a path", () => {
    expect(countLinks("Schauen Sie auf https://a.de und www.b.de oder c.com/angebot")).toBe(3);
  });

  it("does not count a domain named in passing or an e-mail address", () => {
    expect(countLinks("Unsere Seite cafe-mueller.de ist alt, schreiben Sie an info@cafe.de")).toBe(
      0,
    );
  });
});

describe("messageProblem", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");

  it("lets an ordinary question through", () => {
    expect(messageProblem("Was kostet eine neue Website?", null, now)).toBeNull();
  });

  it("refuses empty text, link lists and walls of lines", () => {
    expect(messageProblem("", null, now)).toBe("empty");
    expect(messageProblem("https://a.de https://b.de https://c.de https://d.de", null, now)).toBe(
      "links",
    );
    expect(messageProblem("x\n".repeat(MAX_LINES) + "x", null, now)).toBe("lines");
  });

  it("refuses the same text twice within the window, not later", () => {
    const previous = { body: "Hallo?", createdAt: new Date(now - 10_000) };
    expect(messageProblem("Hallo?", previous, now)).toBe("duplicate");
    expect(messageProblem("Hallo?", previous, now + DUPLICATE_WINDOW_MS)).toBeNull();
    expect(messageProblem("Hallo, noch da?", previous, now)).toBeNull();
  });
});
