const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain template, like the sign-in mail: readable in every client, no images. */
export function notificationEmail(input: { title: string; body: string; url: string }) {
  return {
    subject: input.title,
    text: [input.body, "", `Im Cockpit ansehen: ${input.url}`].join("\n"),
    html: `<!doctype html><html lang="de"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p style="font-size:18px;font-weight:600;margin:0 0 8px">${escape(input.title)}</p>
<p>${escape(input.body)}</p>
<p><a href="${escape(input.url)}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Im Cockpit ansehen</a></p>
<p style="color:#555;font-size:14px">Welche Benachrichtigungen Sie bekommen, stellen Sie im Cockpit unter Einstellungen → Benachrichtigungen ein.</p>
</body></html>`,
  };
}

export interface DigestItem {
  title: string;
  body: string;
  url: string;
}

export function digestEmail(input: {
  date: string;
  summary: string;
  items: DigestItem[];
  url: string;
}) {
  const list = input.items
    .map(
      (item) =>
        `<li style="margin:0 0 12px"><a href="${escape(item.url)}" style="color:#111;font-weight:600">${escape(item.title)}</a><br>${escape(item.body)}</li>`,
    )
    .join("");
  return {
    subject: `Aquisiteur: Ihr Überblick für ${input.date}`,
    text: [
      input.summary,
      "",
      ...input.items.flatMap((item) => [item.title, item.body, item.url, ""]),
      `Heute im Cockpit: ${input.url}`,
    ].join("\n"),
    html: `<!doctype html><html lang="de"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p style="font-size:18px;font-weight:600;margin:0 0 8px">Ihr Überblick für ${escape(input.date)}</p>
<p>${escape(input.summary)}</p>
${list ? `<ul style="padding-left:20px">${list}</ul>` : ""}
<p><a href="${escape(input.url)}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none">„Heute“ öffnen</a></p>
</body></html>`,
  };
}
