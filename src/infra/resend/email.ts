import { Resend } from "resend";
import type { EmailPort } from "../types";

export function resendEmail(apiKey: string, defaultFrom: string): EmailPort {
  const client = new Resend(apiKey);
  return {
    async send(message) {
      const { data, error } = await client.emails.send({
        from: message.from ?? defaultFrom,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
      });
      if (error) throw new Error(`Resend error: ${error.message}`);
      return { id: data?.id ?? null };
    },
  };
}
