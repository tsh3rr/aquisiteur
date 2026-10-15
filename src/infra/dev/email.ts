import type { EmailMessage, EmailPort } from "../types";

/**
 * Development adapter: prints mails to the server log instead of sending
 * them, so magic links work locally without a mail account. With
 * EMAIL_LOG_FILE set (E2E tests) each mail is also appended as a JSON line.
 * Refuses to run in production unless ALLOW_LOG_EMAIL=1 (used by CI only).
 */
export function logEmail(): EmailPort {
  return {
    async send(message: EmailMessage) {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOG_EMAIL !== "1") {
        throw new Error("EMAIL_PROVIDER=log is not allowed in production");
      }
      console.info(`\n[email] to=${message.to}\n[email] subject=${message.subject}\n${message.text}\n`);
      const file = process.env.EMAIL_LOG_FILE;
      if (file) {
        const { appendFile } = await import("node:fs/promises");
        await appendFile(file, `${JSON.stringify({ ...message, sentAt: new Date().toISOString() })}\n`);
      }
      return { id: null };
    },
  };
}
