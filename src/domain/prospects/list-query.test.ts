import { describe, expect, it } from "vitest";
import {
  BUILT_IN_VIEWS,
  canonicalViewQuery,
  DEFAULT_COLUMNS,
  parseListQuery,
  serializeListQuery,
} from "./list-query";

describe("customer list query", () => {
  it("falls back to defaults and drops unknown values", () => {
    expect(parseListQuery({ status: "bogus", aktiv: "1y", sort: "x", spalten: "nope" })).toEqual({
      q: "",
      statuses: [],
      activity: null,
      tag: null,
      campaign: null,
      sort: "activity",
      dir: "desc",
      columns: DEFAULT_COLUMNS,
    });
  });

  it("reads repeated and comma-separated statuses", () => {
    const query = parseListQuery(new URLSearchParams("status=opened,won&status=opened&q= Café "));
    expect(query.statuses).toEqual(["opened", "won"]);
    expect(query.q).toBe("Café");
  });

  it("reads the campaign filter", () => {
    expect(parseListQuery({ kampagne: "none" }).campaign).toBe("none");
    expect(parseListQuery({ kampagne: "x" }).campaign).toBeNull();
    const id = "6f1c2a3e-1111-4222-8333-444455556666";
    expect(serializeListQuery(parseListQuery({ kampagne: id }))).toBe(`kampagne=${id}`);
  });

  it("round-trips through the URL and leaves defaults out", () => {
    const query = parseListQuery({ status: "opened", aktiv: "7d", sort: "company", dir: "asc" });
    expect(serializeListQuery(query)).toBe("status=opened&aktiv=7d&sort=company&dir=asc");
    expect(serializeListQuery(parseListQuery({}))).toBe("");
  });

  it("normalises built-in views", () => {
    for (const view of BUILT_IN_VIEWS) expect(canonicalViewQuery(view.query)).toBe(view.query);
  });
});
