import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  likePattern,
  matchCommands,
  normalize,
  resolveSequence,
  scoreText,
  searchQuerySchema,
} from "./search";

describe("normalize", () => {
  it("folds case, umlauts and accents", () => {
    expect(normalize("  Café  MÜLLER Straße ")).toBe("cafe mueller strasse");
  });
});

describe("scoreText", () => {
  it("prefers a label start over a word start over a substring", () => {
    const start = scoreText("ca", "Café Müller");
    const word = scoreText("mü", "Café Müller");
    const inside = scoreText("ll", "Café Müller");
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(0);
  });

  it("finds umlauts in either spelling", () => {
    expect(scoreText("mueller", "Café Müller")).toBeGreaterThan(0);
    expect(scoreText("muller", "Café Müller")).toBeGreaterThan(0);
    expect(scoreText("müller", "Mueller GmbH")).toBeGreaterThan(0);
  });

  it("needs every word to match", () => {
    expect(scoreText("cafe leipzig", "Café Müller")).toBe(0);
    expect(scoreText("cafe mül", "Café Müller")).toBeGreaterThan(0);
  });

  it("falls back to keywords", () => {
    expect(scoreText("kanban", "Pipeline", ["kanban"])).toBe(1);
    expect(scoreText("xyz", "Pipeline", ["kanban"])).toBe(0);
  });
});

describe("matchCommands", () => {
  it("returns every command for an empty query", () => {
    expect(matchCommands("  ")).toHaveLength(COMMANDS.length);
  });

  it("ranks the label match first", () => {
    expect(matchCommands("kunden")[0]?.id).toBe("go.prospects");
    expect(matchCommands("dunkel")[0]?.id).toBe("theme.dark");
    expect(matchCommands("neu").map((c) => c.id)).toContain("new.prospect");
  });
});

describe("resolveSequence", () => {
  it("waits after a prefix and resolves the full sequence", () => {
    expect(resolveSequence(["g"])).toEqual({ command: null, pending: true });
    expect(resolveSequence(["g", "k"]).command?.id).toBe("go.prospects");
    expect(resolveSequence(["?"]).command?.id).toBe("help.shortcuts");
    expect(resolveSequence(["x"])).toEqual({ command: null, pending: false });
  });

  it("binds every sequence once", () => {
    const bound = COMMANDS.filter((c) => c.keys).map((c) => c.keys!.join(" "));
    expect(new Set(bound).size).toBe(bound.length);
  });
});

describe("query handling", () => {
  it("escapes LIKE wildcards", () => {
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });

  it("trims and bounds the query", () => {
    expect(searchQuerySchema.safeParse("  ").success).toBe(false);
    expect(searchQuerySchema.safeParse("x".repeat(101)).success).toBe(false);
    expect(searchQuerySchema.parse(" Müller ")).toBe("Müller");
  });
});
