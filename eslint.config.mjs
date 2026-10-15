import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * Provider SDKs and bindings may only be imported inside src/infra/ (§5a).
 * Everything else talks to providers through the ports exported by "@/infra".
 */
export const providerImportRestrictions = {
  patterns: [
    {
      regex: "^cloudflare:",
      message: "Cloudflare bindings belong in src/infra/. Use a port from '@/infra'.",
    },
    {
      group: [
        "@opennextjs/cloudflare",
        "@opennextjs/cloudflare/*",
        "wrangler",
        "resend",
        "@supabase/*",
        "@aws-sdk/*",
        "aws4fetch",
        "web-push",
        "pg-boss",
        "inngest",
      ],
      message: "Provider SDKs belong in src/infra/. Use a port from '@/infra'.",
    },
    {
      group: ["sharp"],
      message: "Images are optimised by the CLI at publish time (scripts/), never at runtime (§5).",
    },
    {
      group: [
        "@/infra/*",
        "**/infra/cloudflare/*",
        "**/infra/resend/*",
        "**/infra/portable/*",
        "**/infra/dev/*",
        "**/infra/s3/*",
      ],
      message: "Import the provider-neutral facade '@/infra' instead of a concrete adapter.",
    },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["src/infra/**", "*.config.{ts,mjs}", "scripts/**"],
    rules: {
      "no-restricted-imports": ["error", providerImportRestrictions],
    },
  },
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "node_modules/**",
    "next-env.d.ts",
    "cloudflare-env.d.ts",
    "drizzle/**",
    "playwright-report/**",
    "test-results/**",
    ".lighthouseci/**",
    "lighthouserc.cjs",
  ]),
]);
