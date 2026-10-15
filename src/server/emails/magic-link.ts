/** Sign-in mail. Kept as a plain template; React Email arrives with the notification mails (phase 4). */
export function magicLinkEmail({ url }: { url: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const escapedUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return {
    subject: "Ihr Anmeldelink für Aquisiteur",
    text: [
      "Hallo,",
      "",
      "mit diesem Link melden Sie sich bei Aquisiteur an. Er ist 10 Minuten gültig und funktioniert nur einmal:",
      url,
      "",
      "Wenn Sie keine Anmeldung angefordert haben, können Sie diese E-Mail ignorieren.",
    ].join("\n"),
    html: `<!doctype html><html lang="de"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>Hallo,</p>
<p>mit diesem Link melden Sie sich bei Aquisiteur an. Er ist 10&nbsp;Minuten gültig und funktioniert nur einmal.</p>
<p><a href="${escapedUrl}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Bei Aquisiteur anmelden</a></p>
<p style="color:#555;font-size:14px">Wenn Sie keine Anmeldung angefordert haben, können Sie diese E-Mail ignorieren.</p>
</body></html>`,
  };
}
