import "dotenv/config";

/**
 * Runs the hourly jobs on a deployment without a Cloudflare cron trigger
 * (e.g. a VPS crontab): `5 * * * * cd /app && pnpm jobs:hourly`.
 * Needs APP_URL and CRON_SECRET.
 */
const appUrl = process.env.APP_URL?.replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!appUrl || !secret) throw new Error("APP_URL and CRON_SECRET must be set");

const response = await fetch(`${appUrl}/api/jobs/hourly`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    // Behind Cloudflare the rule adds it anyway; this also works on a direct call.
    ...(process.env.ORIGIN_SECRET ? { "x-aquisiteur-origin": process.env.ORIGIN_SECRET } : {}),
  },
});
console.log(response.status, await response.text());
if (!response.ok) process.exitCode = 1;
