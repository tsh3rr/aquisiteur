import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E = {
  baseURL: `http://localhost:${PORT}`,
  databaseUrl:
    process.env.E2E_DATABASE_URL ??
    "postgres://aquisiteur:aquisiteur@localhost:5432/aquisiteur_e2e",
  mailLog: "test-results/mails.jsonl",
};

// Locally a preinstalled Chromium can be used instead of `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: E2E.baseURL,
    trace: "retain-on-failure",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], launchOptions: { executablePath } },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? "pnpm start" : "pnpm build && pnpm start",
    port: PORT,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      HOSTING_PROFILE: "node",
      DATABASE_URL: E2E.databaseUrl,
      APP_URL: E2E.baseURL,
      PLATFORM_DOMAIN: "localhost",
      BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
      SIGNUP_ALLOWLIST: "owner@e2e.test",
      EMAIL_PROVIDER: "log",
      ALLOW_LOG_EMAIL: "1",
      EMAIL_LOG_FILE: E2E.mailLog,
    },
  },
});
