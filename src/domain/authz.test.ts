import { describe, expect, it } from "vitest";
import { type Action, assertCan, can, ForbiddenError } from "./authz";

const ws = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";

describe("can()", () => {
  it("lets the owner do everything in their workspace", () => {
    const actions: Action[] = [
      "workspace.delete",
      "workspace.export",
      "settings.update",
      "apiTokens.manage",
    ];
    for (const action of actions) {
      expect(
        can({ userId: "u", role: "owner", workspaceId: ws }, action, { workspaceId: ws }),
      ).toBe(true);
    }
  });

  it("never crosses workspaces, whatever the role", () => {
    expect(
      can({ userId: "u", role: "owner", workspaceId: ws }, "workspace.read", {
        workspaceId: other,
      }),
    ).toBe(false);
  });

  it("denies non-members", () => {
    expect(
      can({ userId: "u", role: null, workspaceId: ws }, "workspace.read", { workspaceId: ws }),
    ).toBe(false);
  });

  it("keeps destructive actions away from admins and members", () => {
    expect(
      can({ userId: "u", role: "admin", workspaceId: ws }, "workspace.delete", { workspaceId: ws }),
    ).toBe(false);
    expect(
      can({ userId: "u", role: "member", workspaceId: ws }, "settings.update", { workspaceId: ws }),
    ).toBe(false);
    expect(
      can({ userId: "u", role: "member", workspaceId: ws }, "settings.read", { workspaceId: ws }),
    ).toBe(true);
  });

  it("assertCan throws ForbiddenError", () => {
    expect(() =>
      assertCan({ userId: "u", role: "member", workspaceId: ws }, "domains.manage", {
        workspaceId: ws,
      }),
    ).toThrow(ForbiddenError);
  });
});
