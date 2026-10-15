import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/** The lint rule that keeps provider code inside src/infra/ (§5a). */
async function lint(filePath: string, code: string) {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports");
}

describe("infra boundary lint rule", () => {
  it("rejects provider SDKs and bindings in feature code", async () => {
    const messages = await lint(
      "src/server/example.ts",
      [
        'import { env } from "cloudflare:workers";',
        'import { getCloudflareContext } from "@opennextjs/cloudflare";',
        'import { Resend } from "resend";',
        'import { cloudflareDatabase } from "@/infra/cloudflare/database";',
        "export const x = [env, getCloudflareContext, Resend, cloudflareDatabase];",
      ].join("\n"),
    );
    expect(messages).toHaveLength(4);
  });

  it("allows the neutral facade in feature code", async () => {
    const messages = await lint(
      "src/server/example.ts",
      'import { getInfra } from "@/infra";\nexport const x = getInfra;\n',
    );
    expect(messages).toHaveLength(0);
  });

  it("allows provider imports inside src/infra/", async () => {
    const messages = await lint(
      "src/infra/cloudflare/example.ts",
      'import { getCloudflareContext } from "@opennextjs/cloudflare";\nexport const x = getCloudflareContext;\n',
    );
    expect(messages).toHaveLength(0);
  });
});
