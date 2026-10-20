/*
 * Cockpit service worker: owner notifications only (§7.7). No caching, no
 * offline mode. Payload: { title, body, url, tag?, renotify?, actions? }
 * where each action is { action, title, url }. A tap opens `url` (the spot
 * the event happened); if the open window cannot be navigated, the page is
 * asked to go there itself (NotificationNavigator).
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Aquisiteur", body: event.data ? event.data.text() : "" };
  }
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const urls = Object.fromEntries(actions.map((a) => [a.action, a.url]));
  event.waitUntil(
    self.registration.showNotification(data.title || "Aquisiteur", {
      body: data.body || "",
      tag: data.tag,
      renotify: Boolean(data.tag && data.renotify),
      icon: "/icon.svg",
      badge: "/icon.svg",
      lang: "de",
      data: { url: data.url || "/", urls },
      actions: actions.map((a) => ({ action: a.action, title: a.title })),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url = "/", urls = {} } = event.notification.data || {};
  const target = new URL((event.action && urls[event.action]) || url, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows.find(
        (w) => new URL(w.url).origin === self.location.origin && "focus" in w,
      );
      if (!client) return self.clients.openWindow(target);
      // Focus first: browsers allow it only right after the tap.
      await client.focus();
      // Land where the event happened (§7.7), not on whatever page was open.
      if ("navigate" in client) {
        try {
          if (await client.navigate(target)) return undefined;
        } catch {
          // Not navigable from here (e.g. uncontrolled); let the page do it.
        }
      }
      client.postMessage({ type: "notification.open", url: target });
      return undefined;
    })(),
  );
});
