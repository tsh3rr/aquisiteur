"use client";

import { BellRing, Smartphone, Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  removePushDeviceAction,
  sendTestPushAction,
  subscribePushAction,
} from "./notification-actions";

export interface PushDevice {
  id: string;
  endpoint: string;
  label: string | null;
  lastSuccessAt: string | null;
}

type Support = "checking" | "unsupported" | "ios_install" | "denied" | "ready";

function keyBytes(base64url: string) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** „Chrome auf Android“, so the owner can tell devices apart. */
function deviceLabel(userAgent: string) {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const system = /iPhone|iPad/.test(userAgent)
    ? "iPhone/iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return system ? `${browser} auf ${system}` : browser;
}

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/** Settings → Benachrichtigungen: Web Push on this device and the list of devices (§7.7). */
export function PushDevices({
  publicKey,
  devices,
}: {
  publicKey: string | null;
  devices: PushDevice[];
}) {
  const [support, setSupport] = useState<Support>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      let next: Support = "ready";
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        next = ios && !standalone ? "ios_install" : "unsupported";
      } else if (Notification.permission === "denied") {
        next = "denied";
      } else {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setEndpoint(subscription?.endpoint ?? null);
      }
      if (!cancelled) setSupport(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const thisDevice = endpoint ? devices.find((device) => device.endpoint === endpoint) : undefined;

  function enable() {
    if (!publicKey) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setSupport(permission === "denied" ? "denied" : "ready");
          setMessage({
            tone: "danger",
            text: "Ohne Ihre Erlaubnis kann der Browser keine Push-Nachrichten zeigen.",
          });
          return;
        }
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes(publicKey),
          }));
        const json = subscription.toJSON();
        const result = await subscribePushAction({
          endpoint: json.endpoint,
          keys: json.keys,
          label: deviceLabel(navigator.userAgent),
        });
        if (!result.ok) throw new Error("rejected");
        setEndpoint(subscription.endpoint);
        setMessage({ tone: "success", text: "Push ist auf diesem Gerät aktiv." });
      } catch {
        setMessage({
          tone: "danger",
          text: "Push konnte nicht aktiviert werden. Bitte versuchen Sie es erneut.",
        });
      }
    });
  }

  function disable() {
    setMessage(null);
    startTransition(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removePushDeviceAction({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setEndpoint(null);
      setMessage({ tone: "success", text: "Push ist auf diesem Gerät aus." });
    });
  }

  function test() {
    setMessage(null);
    startTransition(async () => {
      setMessage({ tone: "success", text: await sendTestPushAction() });
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await removePushDeviceAction({ id });
    });
  }

  return (
    <div className="grid gap-4">
      {!publicKey ? (
        <Alert tone="warning">
          Push ist auf diesem Server noch nicht eingerichtet (VAPID-Schlüssel fehlen, siehe
          Deploy-Anleitung). Benachrichtigungen erscheinen trotzdem im Cockpit und per E-Mail.
        </Alert>
      ) : support === "unsupported" ? (
        <Alert tone="info">Dieser Browser unterstützt keine Push-Nachrichten.</Alert>
      ) : support === "ios_install" ? (
        <Alert tone="info">
          Auf dem iPhone funktioniert Push nur aus der installierten App: Tippen Sie in Safari auf
          „Teilen“ → „Zum Home-Bildschirm“ und öffnen Sie Aquisiteur von dort.
        </Alert>
      ) : support === "denied" ? (
        <Alert tone="warning">
          Benachrichtigungen sind für diese Seite im Browser blockiert. Erlauben Sie sie in den
          Website-Einstellungen des Browsers und laden Sie die Seite neu.
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {thisDevice || endpoint ? (
            <>
              <p className="flex items-center gap-2 text-sm font-medium">
                <BellRing aria-hidden className="size-4 text-success" />
                Push ist auf diesem Gerät aktiv.
              </p>
              <Button variant="secondary" onClick={test} disabled={pending}>
                Test senden
              </Button>
              <Button variant="ghost" onClick={disable} disabled={pending}>
                Auf diesem Gerät ausschalten
              </Button>
            </>
          ) : (
            <Button onClick={enable} disabled={pending || support === "checking"}>
              <BellRing aria-hidden />
              Push auf diesem Gerät aktivieren
            </Button>
          )}
        </div>
      )}

      <div aria-live="polite">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      </div>

      {devices.length > 0 ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Ihre Geräte</h3>
          <ul className="grid gap-2">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
              >
                <span className="flex items-center gap-2 text-sm">
                  <Smartphone aria-hidden className="size-4 text-foreground-muted" />
                  <span className="font-medium">{device.label ?? "Gerät"}</span>
                  {device.endpoint === endpoint ? (
                    <span className="text-foreground-muted">(dieses Gerät)</span>
                  ) : null}
                  <span className="text-foreground-muted">
                    {device.lastSuccessAt
                      ? `· zuletzt zugestellt ${dateFormat.format(new Date(device.lastSuccessAt))}`
                      : "· noch nichts zugestellt"}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(device.id)}
                  disabled={pending}
                  aria-label={`${device.label ?? "Gerät"} entfernen`}
                >
                  <Trash2 aria-hidden />
                  Entfernen
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
